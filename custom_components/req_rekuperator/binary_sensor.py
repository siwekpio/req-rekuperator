# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Explicit binary preheater state from Values[72]."""
from homeassistant.components.binary_sensor import BinarySensorEntity
from .entity import ReqEntity


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data['req_rekuperator'][entry.entry_id]
    async_add_entities([ReqHeater(coordinator, entry, 'grzalka_wstepna', 'Grzałka Wstępna')])


class ReqHeater(ReqEntity, BinarySensorEntity):
    @property
    def is_on(self):
        return self.read()
