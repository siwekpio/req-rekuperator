# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Run without Home Assistant: python -m unittest discover -s tests -v."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parents[1] / 'custom_components' / 'req_rekuperator'
# Stub the only Home Assistant import used by the pure constant module.
ha = types.ModuleType('homeassistant')
ha_const = types.ModuleType('homeassistant.const')
class Platform:
    SENSOR='sensor';BINARY_SENSOR='binary_sensor';NUMBER='number';SWITCH='switch';BUTTON='button'
ha_const.Platform = Platform
sys.modules.setdefault('homeassistant', ha)
sys.modules.setdefault('homeassistant.const', ha_const)
package = types.ModuleType('req_rekuperator')
package.__path__ = [str(ROOT)]
sys.modules['req_rekuperator'] = package
for name in ('const', 'protocol'):
    spec = importlib.util.spec_from_file_location(f'req_rekuperator.{name}', ROOT / (name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
P = sys.modules['req_rekuperator.protocol']


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.values = [0] * 101
        for i, v in {0:1, 1:370, 2:21.0, 3:70, 4:100, 5:80, 6:110, 7:42, 8:560,
                     10:8, 39:2, 55:7.2, 56:11.6, 57:21, 58:21.8,
                     65:14, 66:25, 72:0, 81:10, 82:13, 83:88}.items():
            self.values[i] = v

    def test_mac(self):
        self.assertEqual('AA:BB:CC:DD:EE:FF', P.normalize_mac('aa-bb-cc-dd-ee-ff'))
        for bad in ('broken', 'AA:BB/CC/#', 'not-a-mac'):
            with self.assertRaises(ValueError): P.normalize_mac(bad)

    def test_real_device_example_indexes(self):
        data = P.build_values(self.values, None)
        self.assertEqual(data['predkosc_nawiewu'], 70)
        self.assertEqual(data['predkosc_wywiewu'], 100)
        self.assertEqual(data['zadany_nawiew_reczny'], 80)
        self.assertEqual(data['zadany_wyciag_reczny'], 110)
        self.assertEqual(data['sumaryczny_pobor_mocy'], 23)
        self.assertEqual(data['sprawnosc'], 95)
        self.assertEqual(data['stan_bypassu'], 'Zamknięty (Auto)')
        self.assertIs(data['grzalka_wstepna'], False)

    def test_heater_and_bypass_prevent_efficiency(self):
        self.values[72] = 1
        self.assertIsNone(P.build_values(self.values, None)['sprawnosc'])
        self.values[72] = 0
        self.values[39] = 3
        self.assertIsNone(P.build_values(self.values, None)['sprawnosc'])

    def test_bad_temperature_gap_and_invalid_percentage(self):
        self.values[39] = 2
        self.values[55] = 20
        self.assertIsNone(P.build_values(self.values, None)['sprawnosc'])
        self.values[55] = 7
        self.values[57] = 30
        self.assertIsNone(P.build_values(self.values, None)['sprawnosc'])

    def test_unknown_values_not_fake_zero(self):
        self.values[81] = 'unavailable'
        self.assertIsNone(P.build_values(self.values, None)['sumaryczny_pobor_mocy'])
        self.values[72] = 'unknown'
        self.assertIsNone(P.build_values(self.values, None)['grzalka_wstepna'])
        self.assertIsNone(P.build_values(self.values, None)['sprawnosc'])

    def test_json_validation(self):
        self.assertEqual(self.values, P.decode_work(json.dumps({
            'CurrentWorkParametersResult': True, 'Values':self.values})))
        for payload in ('{}', '{', '{"CurrentWorkParametersResult":true,"Values":[0]}'):
            with self.assertRaises(ValueError): P.decode_work(payload)

    def test_temperature_priority(self):
        current = {'IntakeTemp':8.3,'SupplyTemp':20.1,'ExtractTemp':21.0,'LauncherTemp':12.0}
        self.assertEqual(P.build_values(self.values, current)['temperatura_czerpnia'],8.3)
        self.assertIsNotNone(P.build_values(self.values, current)['sprawnosc'])


if __name__ == '__main__':
    unittest.main()
