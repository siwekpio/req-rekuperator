# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""REQ-005: tests pure address policy and real config-flow method body (HA stubs).

No HTTP requests, broker or physical rekuperator are used.
"""
from __future__ import annotations

import ast
import asyncio
from pathlib import Path
import unittest
from types import SimpleNamespace
import importlib.util

ROOT = Path(__file__).resolve().parents[1] / 'custom_components' / 'req_rekuperator'
spec = importlib.util.spec_from_file_location('req019_network', ROOT / 'network.py')
network = importlib.util.module_from_spec(spec)
spec.loader.exec_module(network)

# Exercise the original class and methods. Stub only Home Assistant / Voluptuous
# boundaries, rather than reimplementing address validation or config logic.
source = ast.parse((ROOT / 'config_flow.py').read_text())
flow_class = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == 'ReqConfigFlow')

class FlowBase:
    def __init_subclass__(cls, **kwargs):
        return super().__init_subclass__()
    def __init__(self):
        self.hass = object()
        self.unique_id = None
    async def async_set_unique_id(self, value):
        self.unique_id = value
    def _abort_if_unique_id_configured(self):
        pass
    def async_create_entry(self, **kwargs):
        return {'kind': 'entry', **kwargs}
    def async_show_form(self, **kwargs):
        return {'kind': 'form', **kwargs}

class Vol:
    Optional = staticmethod(lambda name, default='': name)
    Schema = staticmethod(lambda schema: schema)

class Response:
    def __init__(self, content):
        self.content=content
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    def raise_for_status(self):pass
    async def json(self, **kwargs):return self.content

class Session:
    def __init__(self, content):
        self.content=content; self.requests=[]
    def get(self, url, **kwargs):
        self.requests.append((url, kwargs))
        return Response(self.content)

class FlowTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        from unittest.mock import Mock
        from ipaddress import IPv4Address
        # Never connect: fake session records all HTTP attempts.
        self.session = Session({'APIResult':True,'MAC':'AA:BB:CC:DD:EE:FF'})
        self.globals = {
            'config_entries':SimpleNamespace(ConfigFlow=FlowBase),
            'DOMAIN':'req_rekuperator', 'vol':Vol,
            'CONF_NAME':'name', 'CONF_HOST':'host', 'CONF_MAC':'mac',
            'normalize_mac':lambda value: ':'.join(value.upper().split(':')) if len(value.split(':'))==6 else (_ for _ in ()).throw(ValueError('bad MAC')),
            'is_allowed_lan_ipv4':network.is_allowed_lan_ipv4,
            'async_get_clientsession':lambda hass: self.session,
            'aiohttp':__import__('aiohttp'),
            'ValueError':ValueError,'TypeError':TypeError,'TimeoutError':TimeoutError,
        }
        exec(compile(ast.Module(body=[flow_class], type_ignores=[]), str(ROOT / 'config_flow.py'),'exec'),self.globals)
        self.flow=self.globals['ReqConfigFlow']()

    async def test_invalid_host_rejected_before_any_http_even_with_manual_mac(self):
        invalid=['169.254.169.254','0.0.0.0','127.0.0.1','8.8.8.8','192.0.2.17',
                 '224.0.0.1','255.255.255.255','::1','http://192.168.1.2','localhost','192.168.1.2:80',
                 '172.15.0.1','172.32.0.1','192.167.1.1','192.169.1.1']
        for host in invalid:
            with self.subTest(host=host):
                result=await self.flow.async_step_user({'host':host,'mac':'AA:BB:CC:DD:EE:FF'})
                self.assertEqual(result['kind'],'form')
                self.assertEqual(result['errors']['host'],'invalid_host')
                self.assertEqual(self.session.requests,[])

    async def test_accepted_lan_address_discovers_mac(self):
        for host in ['10.1.2.3','172.16.1.2','172.31.255.254','192.168.4.22']:
            with self.subTest(host=host):
                result=await self.flow.async_step_user({'host':host})
                self.assertEqual(result['kind'],'entry')
                self.assertEqual(result['data']['host'],host)
                self.assertEqual(result['data']['mac'],'AA:BB:CC:DD:EE:FF')
                self.assertFalse(self.session.requests[-1][1]['allow_redirects'])

    async def test_empty_host_with_manual_mac_still_works_without_http(self):
        result=await self.flow.async_step_user({'host':'  ', 'mac':'AA:BB:CC:DD:EE:FF'})
        self.assertEqual(result['kind'],'entry')
        self.assertEqual(result['data']['host'],'')
        self.assertEqual(self.session.requests,[])

    async def test_empty_host_without_mac_requires_mac(self):
        result=await self.flow.async_step_user({'host':''})
        self.assertEqual(result['errors']['mac'],'mac_required')

class NetworkTests(unittest.TestCase):
    def test_ipv4_rfc1918_membership_and_boundaries(self):
        allowed=('10.0.0.0','10.255.255.255','172.16.0.0','172.31.255.255',
                 '192.168.0.0','192.168.255.255','192.168.3.103')
        denied=('0.0.0.0','0.0.0.1','8.8.8.8','100.64.0.1','169.254.169.254',
                '172.15.255.255','172.32.0.0','192.167.255.255','192.169.0.0',
                '127.0.0.1','224.0.0.1','255.255.255.255','192.0.2.1',
                '198.18.1.1','198.51.100.2','203.0.113.10','::1','::ffff:192.168.1.1',
                '2001:db8::1','192.168.3.103:80','192.168.1.001','192.168.1.1/path',
                'http://10.0.0.1','10.0.0.1\nX','',None,123,'localhost')
        for host in allowed:
            with self.subTest(host=host):self.assertTrue(network.is_allowed_lan_ipv4(host))
        for host in denied:
            with self.subTest(host=host):self.assertFalse(network.is_allowed_lan_ipv4(host))

if __name__=='__main__':unittest.main()
