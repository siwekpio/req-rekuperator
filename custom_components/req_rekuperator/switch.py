# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Power control sends REQNET TurnOn/TurnOff without optimistic state updates."""
from homeassistant.components.switch import SwitchEntity
from .entity import ReqEntity


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data['req_rekuperator'][entry.entry_id]
    async_add_entities([ReqPower(coordinator, entry, 'zasilanie', 'Zasilanie')])


class ReqPower(ReqEntity, SwitchEntity):
    @property
    def is_on(self):
        return self.read()

    async def async_turn_on(self, **kwargs):
        await self.coordinator.command('TurnOn')

    async def async_turn_off(self, **kwargs):
        await self.coordinator.command('TurnOff')
