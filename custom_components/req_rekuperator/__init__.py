# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Independent reQ REQNET MQTT integration for Home Assistant."""
from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol
from homeassistant.components import mqtt
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ConfigEntryNotReady, HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr

from .const import DOMAIN, PLATFORMS
from .coordinator import ReqCoordinator

_LOGGER = logging.getLogger(__name__)

# Integration is configured exclusively using UI/config entries, not YAML.
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

SERVICE_SCHEMAS = {
    "manual_airflow": vol.Schema({vol.Required("entry_id"): str,
                                   vol.Required("supply"): vol.All(vol.Coerce(int), vol.Range(min=80, max=370)),
                                   vol.Required("extract"): vol.All(vol.Coerce(int), vol.Range(min=80, max=370))}),
    "airing": vol.Schema({vol.Required("entry_id"): str,
                           vol.Required("minutes"): vol.All(vol.Coerce(int), vol.Range(min=5, max=95))}),
    "bypass": vol.Schema({vol.Required("entry_id"): str,
                           vol.Required("mode"): vol.All(vol.Coerce(int), vol.In([0, 1, 2]))}),
    "replace_filters": vol.Schema({vol.Required("entry_id"): str}),
}


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Register explicit entry-targeted services exactly once."""
    hass.data.setdefault(DOMAIN, {})
    # Bundled frontend is accessible from HA, including HACS installations.
    # Intentionally do not mutate Lovelace's resource storage (might be YAML mode).
    await hass.http.async_register_static_paths([
        StaticPathConfig("/req-rekuperator", str(Path(__file__).parent / "frontend"), False)
    ])
    for action, schema in SERVICE_SCHEMAS.items():
        if hass.services.has_service(DOMAIN, action):
            continue

        async def dispatch(call: ServiceCall, service_action: str = action) -> None:
            entry_id = call.data["entry_id"]
            coordinator: ReqCoordinator | None = hass.data[DOMAIN].get(entry_id)
            if coordinator is None:
                raise HomeAssistantError("REQNET config entry not found or not loaded")
            if service_action == "manual_airflow":
                supply = call.data["supply"]
                extract = call.data["extract"]
                if (supply - 80) % 10 or (extract - 80) % 10:
                    raise HomeAssistantError("Manual airflow must use steps of 10 m³/h")
                device_max = (coordinator.data or {}).get("max_airflow")
                if device_max is not None and (supply > device_max or extract > device_max):
                    raise HomeAssistantError("Manual airflow exceeds device maximum")
                await coordinator.command("ManualMode", {
                    "airflowvalue": supply, "valueofairextraction": extract,
                })
            elif service_action == "airing":
                await coordinator.command("TurnOnAiring", {"time": call.data["minutes"]})
            elif service_action == "bypass":
                await coordinator.command("SetByPassMode", {"mode": call.data["mode"]})
            elif service_action == "replace_filters":
                await coordinator.command("ReplaceFilters", "")

        hass.services.async_register(DOMAIN, action, dispatch, schema=schema)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up MQTT subscribe/poll, then entity platforms."""
    if not await mqtt.async_wait_for_mqtt_client(hass):
        raise ConfigEntryNotReady("MQTT integration is not available")
    coordinator = ReqCoordinator(hass, entry.data["mac"], entry.data.get("host", ""))
    try:
        await coordinator.async_start()
        hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except Exception:
        coordinator.stop()
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
        raise
    # Optional, one-time cleanup of an old, unverified device model. A registry
    # failure after the platforms and MQTT have started must never turn this
    # otherwise working config entry into a failed/half-loaded setup.
    try:
        registry = dr.async_get(hass)
        # In HA 2026.8+ identifiers are scoped to the config entry.
        lookup = getattr(registry, "async_get_device_by_identifier", None)
        if callable(lookup):
            device = lookup((DOMAIN, entry.data["mac"]), entry.entry_id)
        else:
            device = registry.async_get_device(identifiers={(DOMAIN, entry.data["mac"])})
            if device is not None and entry.entry_id not in device.config_entries:
                device = None
        if device is not None and device.model == "reQ V.400 HRV L (weryfikacja modelu zalecana)":
            registry.async_update_device(device.id, model=None)
    except Exception:
        _LOGGER.warning("Optional legacy model cleanup was skipped", exc_info=True)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        coordinator = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
        if coordinator:
            coordinator.stop()
        return True
    return False
