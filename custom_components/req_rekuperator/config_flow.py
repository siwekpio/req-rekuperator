# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Local REQNET API MAC discovery, with manual MAC for older Wi-Fi firmware."""
from __future__ import annotations

import logging

import aiohttp
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_NAME
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN, CONF_MAC
from .protocol import normalize_mac
from .network import is_allowed_lan_ipv4

_LOGGER = logging.getLogger(__name__)


class ReqConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure one reQ device. Never writes broker credentials to device."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            host = str(user_input.get(CONF_HOST, "")).strip()
            provided_mac = str(user_input.get(CONF_MAC, "")).strip()
            mac = None
            # Only literal IPv4 targets in RFC1918 private LAN ranges are safe.
            # A manual MAC with no host still works (MQTT only).
            if host and not is_allowed_lan_ipv4(host):
                errors[CONF_HOST] = "invalid_host"
            if not errors and provided_mac:
                try:
                    mac = normalize_mac(provided_mac)
                except ValueError:
                    errors[CONF_MAC] = "invalid_mac"
            if not errors and host:
                try:
                    session = async_get_clientsession(self.hass)
                    async with session.get(
                        f"http://{host}/API/RunFunction",
                        params={"name": "API"},
                        timeout=aiohttp.ClientTimeout(total=7),
                        allow_redirects=False,
                    ) as response:
                        response.raise_for_status()
                        info = await response.json(content_type=None)
                    if not isinstance(info, dict) or info.get("APIResult") is not True or not info.get("MAC"):
                        raise ValueError("API did not return MAC")
                    discovered_mac = normalize_mac(str(info["MAC"]))
                    if mac and mac != discovered_mac:
                        errors[CONF_MAC] = "mac_mismatch"
                    else:
                        mac = discovered_mac
                except (aiohttp.ClientError, TimeoutError, ValueError, TypeError):
                    # For older firmware the explicit MAC can be used without API.
                    if not mac:
                        errors[CONF_HOST] = "cannot_connect"
            if not errors and not mac:
                errors[CONF_MAC] = "mac_required"
            if not errors:
                await self.async_set_unique_id(mac)
                self._abort_if_unique_id_configured()
                title = str(user_input.get(CONF_NAME, "")).strip() or "Rekuperator reQ"
                return self.async_create_entry(title=title, data={CONF_MAC: mac, CONF_HOST: host})
        schema = vol.Schema({
            vol.Optional(CONF_NAME, default="Rekuperator reQ"): str,
            vol.Optional(CONF_HOST, default=""): str,
            vol.Optional(CONF_MAC, default=""): str,
        })
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)
