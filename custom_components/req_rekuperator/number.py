# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Manual airflow and comfort settings, reported by device not retained locally."""
from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.exceptions import HomeAssistantError
from .entity import ReqEntity


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data['req_rekuperator'][entry.entry_id]
    async_add_entities([
        ReqNumber(coordinator, entry, 'ustaw_temp_komfortu', 'Ustaw Temp Komfortu', 10, 35, 1, '°C'),
        ReqNumber(coordinator, entry, 'zadany_nawiew_reczny', 'Zadany Nawiew Ręczny', 80, 370, 10, 'm³/h'),
        ReqNumber(coordinator, entry, 'zadany_wyciag_reczny', 'Zadany Wyciąg Ręczny', 80, 370, 10, 'm³/h'),
    ])


class ReqNumber(ReqEntity, NumberEntity):
    _attr_mode = NumberMode.BOX

    def __init__(self, coordinator, entry, key, label, low, high, step, unit):
        super().__init__(coordinator, entry, key, label)
        self._attr_native_min_value = low
        self._attr_native_max_value = high
        self._attr_native_step = step
        self._attr_native_unit_of_measurement = unit

    @property
    def native_value(self):
        # The comfort number uses a write-only key (ustaw_temp_komfortu), while
        # the read-only device snapshot exposes the actual setting under
        # temperatura_komfortu. Keep the two entity IDs and keys unchanged.
        if self.key == 'ustaw_temp_komfortu':
            return (self.coordinator.data or {}).get('temperatura_komfortu')
        return self.read()

    async def async_set_native_value(self, value: float):
        if (value < self.native_min_value or value > self.native_max_value
                or abs((value-self.native_min_value)/self.native_step -
                       round((value-self.native_min_value)/self.native_step)) > 1e-6):
            raise HomeAssistantError('Value outside REQNET limits or invalid step')
        if self.key == 'ustaw_temp_komfortu':
            await self.coordinator.command('SetComfortTemperature', {'temperature': int(value)})
            return
        # ManualMode sets BOTH targets atomically; never fall back to arbitrary defaults.
        partner = ('zadany_wyciag_reczny' if self.key == 'zadany_nawiew_reczny'
                   else 'zadany_nawiew_reczny')
        other = (self.coordinator.data or {}).get(partner)
        max_airflow = (self.coordinator.data or {}).get('max_airflow')
        if max_airflow is not None and (value > max_airflow or (other is not None and other > max_airflow)):
            raise HomeAssistantError('Manual airflow exceeds device maximum')
        if other is None:
            raise HomeAssistantError('Missing other manual airflow setpoint')
        supply = value if self.key == 'zadany_nawiew_reczny' else other
        extract = value if self.key == 'zadany_wyciag_reczny' else other
        await self.coordinator.command('ManualMode', {
            'airflowvalue': int(supply), 'valueofairextraction': int(extract),
        })
