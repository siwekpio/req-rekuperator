# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""REQNET readings including validated heat recovery efficiency."""
from time import monotonic
from homeassistant.components.sensor import SensorEntity, SensorDeviceClass, SensorStateClass
from .const import SENSOR_SPECS
from .entity import ReqEntity
from homeassistant.core import callback
from homeassistant.helpers import entity_registry as er
from .registry_mapping import entity_map


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data['req_rekuperator'][entry.entry_id]
    async_add_entities([ReqSensor(coordinator, entry, key, *spec)
                        for key, spec in SENSOR_SPECS.items()] +
                       [ReqDiagnostics(coordinator, entry)])


class ReqSensor(ReqEntity, SensorEntity):
    def __init__(self, coordinator, entry, key, label, unit, device_class):
        super().__init__(coordinator, entry, key, label)
        if unit:
            self._attr_native_unit_of_measurement = unit
        if device_class:
            self._attr_device_class = SensorDeviceClass(device_class)
        # State class is deliberately limited to continuous measurements.
        if unit in ("°C", "%", "ppm", "W", "m³/h") and key not in ("sprawnosc",):
            self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def extra_state_attributes(self):
        attributes = dict(super().extra_state_attributes)
        if self.key == "przewietrzanie_pozostalo_sekund" and self.read() is not None:
            last = self.coordinator.last_work_utc
            if last is not None:
                # Exposed at the *MQTT response* timestamp, not at the moment
                # the current browser happened to open the dashboard.
                attributes["reqnet_sample_utc"] = last.isoformat()
        return attributes

    @property
    def native_value(self):
        return self.read()


class ReqDiagnostics(ReqEntity, SensorEntity):
    """Read-only connection/API diagnostics; stays available during MQTT outages."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, 'diagnostyka', 'Diagnostyka')
        self._published_entity_map = {}

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self.async_on_remove(self.hass.bus.async_listen(
            er.EVENT_ENTITY_REGISTRY_UPDATED, self._registry_changed))

    @callback
    def _registry_changed(self, event):
        # Also handles entities added after diagnostics, renames, and removals.
        if entity_map(self.hass, self.entry) != self._published_entity_map:
            self.async_write_ha_state()

    @property
    def available(self) -> bool:
        # Diagnostics must remain readable even when telemetry is unavailable.
        return True

    @property
    def native_value(self):
        return 'Połączono' if self.coordinator.is_fresh else 'Brak odpowiedzi'

    @property
    def extra_state_attributes(self):
        coordinator = self.coordinator
        base = dict(super().extra_state_attributes)
        self._published_entity_map = entity_map(coordinator.hass, self.entry)
        base.update({
            'reqnet_entity_map': self._published_entity_map,
            'reqnet_last_mqtt_response': (coordinator.last_work_utc.isoformat()
                                         if coordinator.last_work_utc else None),
            'reqnet_last_mqtt_age_s': (max(0, round(monotonic() - coordinator.last_work_at))
                                      if coordinator.last_work_at is not None else None),
            'reqnet_api_host': coordinator.host or None,
            'reqnet_mac': coordinator.mac,
            'reqnet_last_command': coordinator.last_command,
            'reqnet_last_command_utc': (coordinator.last_command_at.isoformat()
                                         if coordinator.last_command_at else None),
            'reqnet_last_command_status': coordinator.last_command_status,
            'reqnet_last_command_detail': coordinator.last_command_detail,
            'reqnet_api_last_attempt': (coordinator.api_last_attempt.isoformat()
                                       if coordinator.api_last_attempt else None),
            'reqnet_api_last_success': (coordinator.api_last_success.isoformat()
                                       if coordinator.api_last_success else None),
            'reqnet_api_error': coordinator.api_error,
            'reqnet_api_info': coordinator.api_info,
        })
        return base
