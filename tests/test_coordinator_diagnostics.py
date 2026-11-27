# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Offline / API diagnostic backend regression with lightweight HA stubs.

This is a logic test. It does NOT test the integration inside a real HA installation.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import sys
from time import monotonic
import types
import unittest

ROOT=Path(__file__).resolve().parents[1]/'custom_components'/'req_rekuperator'

def stub(name):
    obj=sys.modules.get(name)
    if obj is None:
        obj=types.ModuleType(name)
        sys.modules[name]=obj
    return obj

stub('homeassistant')
ha_const=stub('homeassistant.const')
if not hasattr(ha_const,'Platform'):
    class Platform:
        SENSOR='sensor';BINARY_SENSOR='binary_sensor';NUMBER='number';SWITCH='switch';BUTTON='button'
    ha_const.Platform=Platform

stub('homeassistant.components')
mqtt=stub('homeassistant.components.mqtt')
async def async_publish(*args,**kwargs):return None
mqtt.async_publish=async_publish

core=stub('homeassistant.core')
core.HomeAssistant=object
core.callback=lambda x:x

exceptions=stub('homeassistant.exceptions')
exceptions.HomeAssistantError=type('HomeAssistantError',(Exception,),{})

stub('homeassistant.helpers')
er=stub('homeassistant.helpers.entity_registry')
er.async_get=lambda hass: getattr(hass, 'registry', [])
er.async_entries_for_config_entry=lambda registry, entry_id: [e for e in registry if e.config_entry_id == entry_id]
er.EVENT_ENTITY_REGISTRY_UPDATED='entity_registry_updated'
aio=stub('homeassistant.helpers.aiohttp_client')
aio.async_get_clientsession=lambda hass: None
update=stub('homeassistant.helpers.update_coordinator')
class DataUpdateCoordinator:
    def __class_getitem__(cls, item):return cls
    def __init__(self,hass,logger,name,update_interval):
        self.hass=hass;self.data=None
    def async_set_updated_data(self,data):
        self.data=data
update.DataUpdateCoordinator=DataUpdateCoordinator

entity=stub('homeassistant.helpers.entity')
entity.DeviceInfo=dict
update.CoordinatorEntity=type('CoordinatorEntity',(),{'__init__':lambda self,coord:setattr(self,'coordinator',coord)})
sensor=stub('homeassistant.components.sensor')
sensor.SensorEntity=type('SensorEntity',(),{})
sensor.SensorDeviceClass=lambda x:x
sensor.SensorStateClass=types.SimpleNamespace(MEASUREMENT='measurement')

pkgname='req_012_backend'
pkg=types.ModuleType(pkgname);pkg.__path__=[str(ROOT)];sys.modules[pkgname]=pkg
for name in ('const','protocol','network','coordinator','entity','registry_mapping','sensor'):
    spec=importlib.util.spec_from_file_location(pkgname+'.'+name,ROOT/(name+'.py'))
    obj=importlib.util.module_from_spec(spec);sys.modules[spec.name]=obj;spec.loader.exec_module(obj)
C=sys.modules[pkgname+'.coordinator']
S=sys.modules[pkgname+'.sensor']

class Response:
    def __init__(self,content):self.content=content
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    def raise_for_status(self):pass
    async def json(self,**kwargs):return self.content
class Session:
    def __init__(self,content):self.content=content;self.requests=[]
    def get(self,url,**kwargs):
        self.requests.append((url,kwargs))
        return Response(self.content)
class Hass:
    def async_create_task(self,coro):return asyncio.create_task(coro)

class DiagnosticTests(unittest.IsolatedAsyncioTestCase):
    async def test_api_success_only_reads_and_no_secrets(self):
        session=Session({'APIResult':True,'MAC':'AA:BB:CC:DD:EE:FF',
            'DeviceType':8,'RecuperatorSoftwareVersion':'6.26','APIVersion':19,
            'WIFIIP':'192.168.4.22','WIFISignalStrength':5,'MQTTStatus':True,
            'WIFIStatus':'true','MQTT_ADDITIONAL_BROKER_PASSWORD':'SHOULD_NOT_COPY'})
        C.async_get_clientsession=lambda hass:session
        c=C.ReqCoordinator(Hass(),'AA:BB:CC:DD:EE:FF','192.168.4.22')
        await c._refresh_api_info()
        self.assertIsNone(c.api_error)
        self.assertEqual(c.api_info['APIVersion'],19)
        self.assertNotIn('MQTT_ADDITIONAL_BROKER_PASSWORD',c.api_info)
        self.assertIn('/API/RunFunction',session.requests[0][0])
        self.assertFalse(session.requests[0][1]['allow_redirects'])
        self.assertEqual(session.requests[0][1]['params'],{'name':'API'})
        self.assertIsNone(c.data['temperatura_czerpnia'])

    async def test_mismatched_device_does_not_replace_last_good_data(self):
        session=Session({'APIResult':True,'MAC':'AA:BB:CC:DD:EE:FF','APIVersion':19})
        C.async_get_clientsession=lambda hass:session
        c=C.ReqCoordinator(Hass(),'AA:BB:CC:DD:EE:FF','192.168.4.22')
        await c._refresh_api_info()
        session.content={'APIResult':True,'MAC':'AA:BB:CC:DD:EE:11','APIVersion':999}
        await c._refresh_api_info()
        self.assertIsNotNone(c.api_error)
        self.assertEqual(c.api_info['APIVersion'],19)

    async def test_req005_existing_invalid_host_never_issues_http(self):
        # Old config entries must still operate over MQTT without SSRF risk.
        for host in ('169.254.169.254','0.0.0.0','127.0.0.1',
                     '8.8.8.8','192.0.2.10','::1','http://192.168.1.1'):
            with self.subTest(host=host):
                session=Session({'APIResult':True,'MAC':'AA:BB:CC:DD:EE:FF'})
                C.async_get_clientsession=lambda hass:session
                c=C.ReqCoordinator(Hass(),'AA:BB:CC:DD:EE:FF',host)
                c._schedule_api_check()
                self.assertIsNone(c._api_task)
                self.assertIn('Niedozwolony',c.api_error)
                await c._refresh_api_info()  # Direct call is also protected.
                self.assertEqual(session.requests,[])
                self.assertIsNone(c.api_last_attempt)
                self.assertEqual(c.api_info,{})
                # MQTT status polling still works; HTTP is only supplementary.
                result=await c._async_update_data()
                self.assertIsNone(result['temperatura_czerpnia'])
                self.assertEqual(session.requests,[])

    async def test_req005_allowed_host_runs_normal_http(self):
        for host in ('10.2.3.4','172.16.2.3','172.31.250.1','192.168.2.12'):
            with self.subTest(host=host):
                session=Session({'APIResult':True,'MAC':'AA:BB:CC:DD:EE:FF'})
                C.async_get_clientsession=lambda hass:session
                c=C.ReqCoordinator(Hass(),'AA:BB:CC:DD:EE:FF',host)
                await c._refresh_api_info()
                self.assertIsNone(c.api_error)
                self.assertEqual(len(session.requests),1)

    async def test_missing_mqtt_data_no_fake_live_values(self):
        c=C.ReqCoordinator(Hass(),'AA:BB:CC:DD:EE:FF')
        work=[0]*101
        work[0]=1;work[55]=7.2;work[57]=21.0;work[58]=21.8
        c.work=work
        c.last_work_at=monotonic()-999
        c.last_work_utc=datetime.now(timezone.utc)
        snapshot=await c._async_update_data()
        self.assertIsNone(snapshot['temperatura_czerpnia'])
        diag=S.ReqDiagnostics(c,types.SimpleNamespace(data={'mac':c.mac},entry_id='demo',title='ReQ'))
        self.assertTrue(diag.available)
        self.assertEqual(diag.native_value,'Brak odpowiedzi')
        self.assertIsNotNone(diag.extra_state_attributes['reqnet_last_mqtt_response'])
        c.last_work_at=monotonic()
        snapshot=await c._async_update_data()
        self.assertEqual(snapshot['temperatura_czerpnia'],7.2)
        self.assertEqual(diag.native_value,'Połączono')

    async def test_registry_map_offline_rename_and_isolation(self):
        c=C.ReqCoordinator(Hass(),'AA:BB:CC:DD:EE:FF')
        entry=types.SimpleNamespace(data={'mac':c.mac},entry_id='demo',title='ReQ')
        def item(key, entity_id, eid='demo', prefix='aabbccddeeff_', platform='req_rekuperator', disabled=None):
            return types.SimpleNamespace(unique_id=prefix+key,entity_id=entity_id,
                config_entry_id=eid,platform=platform,disabled_by=disabled)
        temp=item('temperatura_czerpnia','sensor.renamed')
        c.hass.registry=[temp,item('zasilanie','switch.power'),item('diagnostyka','sensor.diag'),
            item('co2','sensor.other',eid='other'),item('co2','sensor.wrong',prefix='112233445566_'),
            item('co2','sensor.foreign',platform='mqtt'),item('co2','sensor.disabled',disabled='user')]
        diag=S.ReqDiagnostics(c,entry)
        diag.hass=c.hass
        self.assertEqual(diag.native_value,'Brak odpowiedzi')
        expected={'temperatura_czerpnia':'sensor.renamed','zasilanie':'switch.power','diagnostyka':'sensor.diag'}
        self.assertEqual(diag.extra_state_attributes['reqnet_entity_map'],expected)
        self.assertNotIn('model',diag.device_info)
        writes=[]
        diag.async_write_ha_state=lambda: writes.append(diag.extra_state_attributes['reqnet_entity_map'])
        diag._registry_changed(None)
        self.assertEqual(writes,[])
        temp.entity_id='sensor.new_name'
        diag._registry_changed(None)
        self.assertEqual(writes[-1]['temperatura_czerpnia'],'sensor.new_name')
        temp.disabled_by='user'
        diag._registry_changed(None)
        self.assertNotIn('temperatura_czerpnia',writes[-1])
        c.hass.registry.remove(temp)
        diag._registry_changed(None)
        self.assertEqual(len(writes),2)

if __name__=='__main__':unittest.main()
