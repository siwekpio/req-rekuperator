# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Base entity with a stable card key and no globally fixed entity ID."""
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN


class ReqEntity(CoordinatorEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator, entry, key: str, label: str) -> None:
        super().__init__(coordinator)
        self.entry = entry
        self.key = key
        self._attr_name = label
        self._attr_unique_id = f"{entry.data['mac'].replace(':', '').lower()}_{key}"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self.entry.data['mac'])},
            name=self.entry.title,
            manufacturer="reQ / REQNET",
        )

    @property
    def extra_state_attributes(self) -> dict:
        # Enables multi-device entity discovery without exposing MAC in the JS card.
        return {"reqnet_entry_id": self.entry.entry_id, "reqnet_key": self.key}

    @property
    def available(self) -> bool:
        return self.coordinator.is_fresh and self.coordinator.data is not None

    def read(self):
        return (self.coordinator.data or {}).get(self.key)
