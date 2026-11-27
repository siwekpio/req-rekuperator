# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Stable, entry-scoped card keys derived from the HA entity registry."""
from homeassistant.helpers import entity_registry as er
from .const import DOMAIN


def entity_map(hass, entry):
    """Never infer entity IDs from names or MQTT availability."""
    prefix = entry.data['mac'].replace(':', '').lower() + '_'
    registry = er.async_get(hass)
    return {
        item.unique_id[len(prefix):]: item.entity_id
        for item in er.async_entries_for_config_entry(registry, entry.entry_id)
        if item.platform == DOMAIN and item.disabled_by is None
        and item.unique_id.startswith(prefix) and len(item.unique_id) > len(prefix)
    }
