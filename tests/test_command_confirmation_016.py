# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""REQNET 0.1.6: simulated MQTT response tests, NOT physical HA tests."""
import asyncio
import json
from time import monotonic
from types import SimpleNamespace
import unittest

# Reuse isolated HA stubs supplied by the older diagnostic tests.
from test_coordinator_diagnostics import C
from req_012_backend.protocol import command_matches_work


def frame(*, on=1, mode=9, supply=100, extract=110, temp=22,
          bypass=2, days=20, minutes=14, seconds=30):
    values = [0] * 101
    for idx, v in {0:on, 1:370, 5:supply, 6:extract, 10:mode, 11:minutes,
                   12:seconds, 39:bypass, 67:temp, 83:days}.items():
        values[idx] = v
    return values


def packet(values, *, retain=False):
    return SimpleNamespace(payload=json.dumps({
        'CurrentWorkParametersResult': True, 'Values': values,
    }), retain=retain)


class MatchTests(unittest.TestCase):
    def test_all_commands(self):
        self.assertTrue(command_matches_work('TurnOn', '', frame(on=1)))
        self.assertTrue(command_matches_work('TurnOff', '', frame(on=0)))
        self.assertTrue(command_matches_work('AutomaticMode', '', frame(mode=9)))
        self.assertTrue(command_matches_work('TurnOnHoliday', '', frame(mode=3)))
        self.assertTrue(command_matches_work('ManualMode', {'airflowvalue':120,'valueofairextraction':130},frame(mode=8,supply=120,extract=130)))
        self.assertTrue(command_matches_work('TurnOnAiring', {'time':15}, frame(mode=4,minutes=14,seconds=50)))
        self.assertTrue(command_matches_work('SetComfortTemperature', {'temperature':23},frame(temp=23)))
        for code in (2,3):
            self.assertTrue(command_matches_work('SetByPassMode',{'mode':2},frame(bypass=code)))
        for code in (0,1):
            self.assertTrue(command_matches_work('SetByPassMode',{'mode':code},frame(bypass=code)))
        self.assertTrue(command_matches_work('ReplaceFilters','',frame(days=60),frame(days=4)))

    def test_rejections_and_no_assumed_filter_cycle(self):
        self.assertFalse(command_matches_work('AutomaticMode','',frame(mode=3)))
        self.assertFalse(command_matches_work('ManualMode',{'airflowvalue':130,'valueofairextraction':120},frame(mode=8,supply=120,extract=130)))
        self.assertFalse(command_matches_work('TurnOnAiring',{'time':5},frame(mode=4,minutes=14,seconds=50)))
        self.assertFalse(command_matches_work('TurnOnAiring',{'time':15},frame(mode=9)))
        self.assertFalse(command_matches_work('SetByPassMode',{'mode':1},frame(bypass=3)))
        self.assertFalse(command_matches_work('ReplaceFilters','',frame(days=20),frame(days=20)))
        self.assertFalse(command_matches_work('ReplaceFilters','',frame(days=90),frame(days=90)))
        self.assertFalse(command_matches_work('ReplaceFilters','',frame(days=90),None))
        self.assertFalse(command_matches_work('SetComfortTemperature',{'temperature':24},frame(temp=22)))
        self.assertFalse(command_matches_work('NotAFunction','',frame()))


class CommandTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.c=C.ReqCoordinator(object(),'AA:BB:CC:DD:EE:FF')
        self.c._handle_work(packet(frame()))
        self.calls=[]
        self.saved_publish=C.mqtt.async_publish
        self.saved_timeout=C.COMMAND_CONFIRM_TIMEOUT
        self.saved_poll=C.COMMAND_POLL_SECONDS
        C.COMMAND_CONFIRM_TIMEOUT=.12
        C.COMMAND_POLL_SECONDS=.025

    async def asyncTearDown(self):
        C.mqtt.async_publish=self.saved_publish
        C.COMMAND_CONFIRM_TIMEOUT=self.saved_timeout
        C.COMMAND_POLL_SECONDS=self.saved_poll
        self.c.stop()

    async def test_success_requires_new_response_not_old_state(self):
        async def publish(hass, topic, payload, **kwargs):
            self.calls.append((topic,payload,kwargs))
            if topic.endswith('/CurrentWorkParameters'):
                self.c._handle_work(packet(frame(mode=3)))
        C.mqtt.async_publish=publish
        await self.c.command('TurnOnHoliday')
        self.assertEqual(self.c.last_command_status,'potwierdzone')
        self.assertEqual([call[0].split('/')[-1] for call in self.calls], ['TurnOnHoliday','CurrentWorkParameters'])
        self.assertTrue(all(call[2]=={'qos':0,'retain':False} for call in self.calls))

    async def test_preexisting_state_and_retained_data_do_not_ack(self):
        async def publish(hass, topic, payload, **kwargs):
            self.calls.append(topic)
            self.c._handle_work(packet(frame(mode=9),retain=True))
        C.mqtt.async_publish=publish
        with self.assertRaisesRegex(C.HomeAssistantError,'Brak potwierdzenia'):
            await self.c.command('AutomaticMode')
        self.assertEqual(self.calls.count('AA:BB:CC:DD:EE:FF/AutomaticMode'),1)
        self.assertEqual(self.c.last_command_status,'niepewne')

    async def test_unchanged_and_malformed_state_timeout(self):
        async def publish(hass,topic,payload,**kwargs):
            self.calls.append(topic)
            if topic.endswith('CurrentWorkParameters'):
                self.c._handle_work(SimpleNamespace(payload='broken',retain=False))
        C.mqtt.async_publish=publish
        with self.assertRaisesRegex(C.HomeAssistantError,'Brak potwierdzenia'):
            await self.c.command('TurnOnHoliday')
        self.assertEqual(self.calls.count('AA:BB:CC:DD:EE:FF/TurnOnHoliday'),1)
        self.assertGreaterEqual(self.calls.count('AA:BB:CC:DD:EE:FF/CurrentWorkParameters'),1)

    async def test_reject_concurrent_command_cross_client(self):
        async def publish(hass,topic,payload,**kwargs):
            self.calls.append(topic)
        C.mqtt.async_publish=publish
        first=asyncio.create_task(self.c.command('TurnOnHoliday'))
        await asyncio.sleep(.01)
        with self.assertRaisesRegex(C.HomeAssistantError,'Inne polecenie'):
            await self.c.command('TurnOff')
        self.c._handle_work(packet(frame(mode=3)))
        await first
        self.assertEqual(self.calls.count('AA:BB:CC:DD:EE:FF/TurnOnHoliday'),1)
        self.assertNotIn('AA:BB:CC:DD:EE:FF/TurnOff',self.calls)

    async def test_filter_reset_only_confirmed_if_days_increase(self):
        async def publish(hass,topic,payload,**kwargs):
            self.calls.append(topic)
            if topic.endswith('CurrentWorkParameters'):
                self.c._handle_work(packet(frame(days=20)))
        C.mqtt.async_publish=publish
        with self.assertRaisesRegex(C.HomeAssistantError,'Brak potwierdzenia'):
            await self.c.command('ReplaceFilters')
        self.assertEqual(self.calls.count('AA:BB:CC:DD:EE:FF/ReplaceFilters'),1)
        # New baseline for an independent subsequent call
        self.calls.clear()
        async def publish_new(hass,topic,payload,**kwargs):
            self.calls.append(topic)
            if topic.endswith('CurrentWorkParameters'):
                self.c._handle_work(packet(frame(days=60)))
        C.mqtt.async_publish=publish_new
        await self.c.command('ReplaceFilters')
        self.assertEqual(self.c.last_command_status,'potwierdzone')

    async def test_response_during_action_publish_is_not_an_ack(self):
        async def publish(hass,topic,payload,**kwargs):
            self.calls.append(topic)
            if topic.endswith('/TurnOnHoliday'):
                self.c._handle_work(packet(frame(mode=3)))
            # No later work response: an action-racing reply is insufficient.
        C.mqtt.async_publish=publish
        with self.assertRaisesRegex(C.HomeAssistantError,'Brak potwierdzenia'):
            await self.c.command('TurnOnHoliday')
        self.assertEqual(self.c.last_command_status,'niepewne')
        self.assertEqual(self.calls.count('AA:BB:CC:DD:EE:FF/TurnOnHoliday'),1)

    async def test_publish_error_does_not_retry_action(self):
        async def publish(hass,topic,payload,**kwargs):
            self.calls.append(topic)
            raise OSError('broker disconnected during publish')
        C.mqtt.async_publish=publish
        with self.assertRaisesRegex(C.HomeAssistantError,'Błąd komunikacji MQTT'):
            await self.c.command('TurnOff')
        self.assertEqual(self.calls,['AA:BB:CC:DD:EE:FF/TurnOff'])
        self.assertEqual(self.c.last_command_status,'niepewne')
        self.assertFalse(self.c._command_active)

    async def test_stale_and_stop_reject_before_send(self):
        async def publish(*args,**kwargs):
            self.calls.append(args)
        C.mqtt.async_publish=publish
        self.c.last_work_at=monotonic()-9999
        with self.assertRaisesRegex(C.HomeAssistantError,'Brak aktualnego'):
            await self.c.command('TurnOn')
        self.c.stop()
        with self.assertRaises(C.HomeAssistantError):
            await self.c.command('TurnOn')
        self.assertFalse(self.calls)

    async def test_cancel_releases_lock_and_stop_fails_waiter(self):
        async def publish(*args,**kwargs):
            self.calls.append(args)
        C.mqtt.async_publish=publish
        t=asyncio.create_task(self.c.command('SetComfortTemperature',{'temperature':25}))
        await asyncio.sleep(.01)
        self.c.stop()
        with self.assertRaises(C.HomeAssistantError):
            await t
        self.assertEqual(self.c.last_command_status,'niepewne')
        self.assertFalse(self.c._command_active)
