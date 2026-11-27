# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""REQ-003: isolated HA device registry compatibility tests, no real HA instance."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'custom_components/req_rekuperator/__init__.py'
source = ast.parse(MODULE.read_text())
node = next(n for n in source.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'async_setup_entry')
node.decorator_list = []
node.returns = None
for param in node.args.args:
    param.annotation = None
# Test the actual setup function body, not a handwritten reimplementation.
code = compile(ast.Module(body=[node], type_ignores=[]), str(MODULE), 'exec')


class Device:
    def __init__(self, id, model, entry_ids=('entry-1',)):
        self.id = id
        self.model = model
        self.config_entries = set(entry_ids)


class ModernRegistry:
    def __init__(self, devices=None):
        self.devices = devices or {}
        self.lookups = []
        self.updates = []
    def async_get_device_by_identifier(self, identifier, entry_id):
        self.lookups.append((identifier, entry_id))
        return self.devices.get((identifier, entry_id))
    def async_get_device(self, *a, **kw):
        raise AssertionError('Deprecated method MUST NOT be called in modern HA')
    def async_update_device(self, id, *, model):
        self.updates.append((id, model))


class LegacyRegistry:
    def __init__(self, device):
        self.device = device
        self.lookups = []
        self.updates = []
    def async_get_device(self, *, identifiers):
        self.lookups.append(identifiers)
        return self.device
    def async_update_device(self, id, *, model):
        self.updates.append((id, model))


class Coordinator:
    def __init__(self, hass, mac, host):
        self.hass = hass
        self.mac = mac
        self.host = host
        self.stopped = False
    async def async_start(self):
        pass
    def stop(self):
        self.stopped = True


class Hass:
    def __init__(self):
        self.data = {}
        self.config_entries = SimpleNamespace(async_forward_entry_setups=self.forward)
        self.forwarded = []
    async def forward(self, entry, platforms):
        self.forwarded.append((entry.entry_id, platforms))


class RegistryTests(unittest.IsolatedAsyncioTestCase):
    def setup_fn(self, registry):
        async def wait(hass):
            return True
        globs = {'mqtt':SimpleNamespace(async_wait_for_mqtt_client=wait),
                 'ReqCoordinator': Coordinator,
                 'dr':SimpleNamespace(async_get=lambda hass:registry),
                 'DOMAIN':'req_rekuperator', 'PLATFORMS':('sensor',),
                 'ConfigEntryNotReady':RuntimeError}
        exec(code, globs)
        return globs['async_setup_entry']

    def entry(self, id='entry-1', mac='02:00:00:00:00:01'):
        return SimpleNamespace(entry_id=id, data={'mac':mac,'host':''})

    async def test_modern_scoped_lookup_and_one_time_cleanup(self):
        ident=('req_rekuperator','02:00:00:00:00:01')
        legacy='reQ V.400 HRV L (weryfikacja modelu zalecana)'
        a=Device('device-A',legacy,('entry-1',))
        b=Device('device-B',legacy,('entry-2',))
        r=ModernRegistry({(ident,'entry-1'):a,(ident,'entry-2'):b})
        fn=self.setup_fn(r); hass=Hass()
        self.assertTrue(await fn(hass,self.entry()))
        self.assertEqual(r.lookups,[(ident,'entry-1')])
        self.assertEqual(r.updates,[('device-A',None)])
        self.assertEqual(hass.forwarded,[('entry-1',('sensor',))])
        r.updates.clear()
        await fn(hass,self.entry('entry-2'))
        self.assertEqual(r.updates,[('device-B',None)])

    async def test_absent_or_custom_model_not_modified(self):
        ident=('req_rekuperator','02:00:00:00:00:01')
        device=Device('keep','Model set by user')
        r=ModernRegistry({(ident,'entry-1'):device})
        fn=self.setup_fn(r)
        await fn(Hass(),self.entry())
        await fn(Hass(),self.entry('other'))
        self.assertFalse(r.updates)

    async def test_legacy_lookup_guarded_by_config_entry_ownership(self):
        legacy='reQ V.400 HRV L (weryfikacja modelu zalecana)'
        foreign=Device('foreign',legacy,('entry-2',))
        r=LegacyRegistry(foreign)
        fn=self.setup_fn(r)
        await fn(Hass(),self.entry('entry-1'))
        self.assertFalse(r.updates)
        own=Device('own',legacy,('entry-1',))
        r.device=own
        await fn(Hass(),self.entry('entry-1'))
        self.assertEqual(r.updates,[('own',None)])

    async def test_setup_never_creates_new_device_during_cleanup(self):
        r=ModernRegistry()
        fn=self.setup_fn(r)
        hass=Hass()
        await fn(hass,self.entry())
        self.assertEqual(len(hass.data['req_rekuperator']),1)
        self.assertEqual(r.updates,[])
