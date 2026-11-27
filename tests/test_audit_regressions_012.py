# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Audit 0.1.12 regression tests using source AST, no physical commands.

Run the actual ReqNumber.native_value getter even without Home Assistant Core
installed in the test runner, and verify optional registry cleanup is safe.
"""
import ast
import logging
from pathlib import Path
from types import SimpleNamespace
import unittest

root = Path(__file__).resolve().parents[1]
number_path = root / 'custom_components/req_rekuperator/number.py'
number_ast = ast.parse(number_path.read_text(encoding='utf-8'))
number_class = next(n for n in number_ast.body if isinstance(n, ast.ClassDef) and n.name == 'ReqNumber')
getter = next(n for n in number_class.body if isinstance(n, ast.FunctionDef) and n.name == 'native_value')
getter.decorator_list = []
getter.returns = None
exec(compile(ast.fix_missing_locations(ast.Module(body=[getter], type_ignores=[])), str(number_path), 'exec'), globals())


class NumberStateTests(unittest.TestCase):
    def _entity(self, key, data):
        value = SimpleNamespace(key=key, coordinator=SimpleNamespace(data=data))
        value.read = lambda: (value.coordinator.data or {}).get(key)
        return value

    def test_comfort_number_reads_device_setting_not_write_only_key(self):
        self.assertEqual(native_value(self._entity('ustaw_temp_komfortu',
            {'temperatura_komfortu': 22.0})), 22.0)

    def test_comfort_missing_is_not_fabricated(self):
        self.assertIsNone(native_value(self._entity('ustaw_temp_komfortu', {})))

    def test_manual_numbers_unchanged(self):
        self.assertEqual(native_value(self._entity('zadany_nawiew_reczny',
            {'zadany_nawiew_reczny': 100})), 100)
        self.assertEqual(native_value(self._entity('zadany_wyciag_reczny',
            {'zadany_wyciag_reczny': 110})), 110)


class OptionalRegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_broken_optional_registry_does_not_break_running_entry(self):
        path = root / 'custom_components/req_rekuperator/__init__.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        method = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'async_setup_entry')
        method.decorator_list = []
        method.returns = None
        for arg in method.args.args:
            arg.annotation = None
        globs = {'DOMAIN': 'req_rekuperator', 'PLATFORMS': ('sensor',),
                 '_LOGGER': logging.getLogger('audit-registry'),
                 'ConfigEntryNotReady': RuntimeError}
        async def wait(_): return True
        class Coordinator:
            def __init__(self, hass, mac, host):
                self.stopped = False
            async def async_start(self): pass
            def stop(self): self.stopped = True
        class Registry:
            def async_get_device_by_identifier(self, *a):
                raise RuntimeError('simulated registry lookup failure')
        globs.update({'mqtt': SimpleNamespace(async_wait_for_mqtt_client=wait),
                      'ReqCoordinator': Coordinator,
                      'dr': SimpleNamespace(async_get=lambda _: Registry())})
        exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), str(path), 'exec'), globs)
        sent=[]
        async def forward(e, p): sent.append(e.entry_id)
        hass=SimpleNamespace(data={},config_entries=SimpleNamespace(async_forward_entry_setups=forward))
        entry=SimpleNamespace(entry_id='e1',data={'mac':'02:00:00:00:00:01','host':''})
        with self.assertLogs('audit-registry', level='WARNING') as logs:
            result=await globs['async_setup_entry'](hass, entry)
        self.assertTrue(result)
        self.assertEqual(sent, ['e1'])
        self.assertFalse(hass.data['req_rekuperator']['e1'].stopped)
        self.assertIn('Optional legacy model cleanup', '\n'.join(logs.output))


if __name__ == '__main__':
    unittest.main()


class MalformedTelemetryTests(unittest.TestCase):
    """Malformed MQTT values must not raise in callbacks or fake sensor values."""

    def test_huge_int_is_unknown(self):
        import test_coordinator_diagnostics  # HA stubs, no real broker
        from req_012_backend.protocol import num
        self.assertIsNone(num([10 ** 400], 0))

    def test_extreme_temperature_falls_back_safely(self):
        import test_coordinator_diagnostics
        from req_012_backend.protocol import build_values
        work = [0] * 84
        work[55] = 9.5
        result = build_values(work, {'IntakeTemp': 10 ** 400})
        self.assertEqual(result['temperatura_czerpnia'], 9.5)

    def test_overflowing_fan_total_is_unknown_not_exception(self):
        import test_coordinator_diagnostics
        from req_012_backend.protocol import build_values
        work = [0] * 84
        work[81] = 1e308
        work[82] = 1e308
        result = build_values(work, None)
        self.assertIsNone(result['sumaryczny_pobor_mocy'])

    def test_recursively_nested_mqtt_frames_are_ignored(self):
        from test_coordinator_diagnostics import C
        coordinator = C.ReqCoordinator(SimpleNamespace(), 'AA:BB:CC:DD:EE:FF')
        payload = '{"CurrentWorkParametersResult":true,"Values":' + '[' * 1200 + '0' + ']' * 1200 + '}'
        coordinator._handle_work(SimpleNamespace(payload=payload,retain=False))
        self.assertIsNone(coordinator.work)
        payload = '{"CurrentTemperaturesResult":true,"IntakeTemp":' + '[' * 1200 + '0' + ']' * 1200 + '}'
        coordinator._handle_temperatures(SimpleNamespace(payload=payload,retain=False))
        self.assertIsNone(coordinator.temperatures)
