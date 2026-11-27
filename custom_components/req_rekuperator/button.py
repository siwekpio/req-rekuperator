# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""REQNET one-shot actions."""
from homeassistant.components.button import ButtonEntity
from .entity import ReqEntity


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data['req_rekuperator'][entry.entry_id]
    async_add_entities([
        ReqButton(coordinator, entry, 'aktywuj_tryb_inteligentny', 'Aktywuj Tryb Inteligentny', 'AutomaticMode'),
        ReqButton(coordinator, entry, 'aktywuj_urlop', 'Aktywuj Urlop', 'TurnOnHoliday'),
        ReqButton(coordinator, entry, 'reset_filtrow', 'Reset Filtrów', 'ReplaceFilters'),
    ])


class ReqButton(ReqEntity, ButtonEntity):
    def __init__(self, coordinator, entry, key, label, function):
        super().__init__(coordinator, entry, key, label)
        self.function = function

    async def async_press(self):
        await self.coordinator.command(self.function)
