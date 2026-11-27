# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""MQTT subscriptions, periodically requested REQNET snapshots, and commands."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import asyncio
import aiohttp
import json
import logging
from time import monotonic
from typing import Any

from homeassistant.components import mqtt
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import (
    SCAN_INTERVAL_SECONDS, STALE_SECONDS, TEMPERATURES_RESULT,
    COMMAND_CONFIRM_TIMEOUT, COMMAND_POLL_SECONDS,
    TOPIC_TEMPERATURES, TOPIC_WORK, WORK_RESULT,
)
from .network import is_allowed_lan_ipv4
from .protocol import (
    build_values, command_matches_work, decode_temperatures, decode_work, normalize_mac,
)

_LOGGER = logging.getLogger(__name__)


class ReqCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Push updates whenever MQTT responds, poll read-only commands periodically."""

    def __init__(self, hass: HomeAssistant, mac: str, host: str = "") -> None:
        super().__init__(hass, _LOGGER, name=f"REQNET {mac}",
                         update_interval=timedelta(seconds=SCAN_INTERVAL_SECONDS))
        self.mac = mac
        self.host = host
        # Keep last confirmed MQTT timestamp for diagnostics, never use stale samples
        # to populate live sensor states.
        self.last_work_utc: datetime | None = None
        self.api_info: dict[str, Any] = {}
        self.api_last_success: datetime | None = None
        self.api_last_attempt: datetime | None = None
        self.api_error: str | None = None
        self._last_api_poll_at: float | None = None
        self._api_task: asyncio.Task | None = None
        self._stopped = False
        self.work: list | None = None
        self.temperatures: dict | None = None
        self.last_work_at: float | None = None
        self.last_temp_at: float | None = None
        self._unsub: list = []
        # Single in-flight command per device (including other users / clients).
        self._command_active = False
        self._command_waiter: asyncio.Future | None = None
        self._command_function: str | None = None
        self._command_payload: dict | str = ""
        self._command_before: list | None = None
        self.last_command: str | None = None
        self.last_command_at: datetime | None = None
        self.last_command_status: str | None = None
        self.last_command_detail: str | None = None
        self.async_set_updated_data(build_values(None, None))

    @property
    def is_fresh(self) -> bool:
        return self.last_work_at is not None and monotonic() - self.last_work_at < STALE_SECONDS

    async def async_start(self) -> None:
        """Subscribe before first poll so a fast device response is not missed."""
        for topic, handler in ((WORK_RESULT, self._handle_work),
                               (TEMPERATURES_RESULT, self._handle_temperatures)):
            unsub = await mqtt.async_subscribe(self.hass, f"{self.mac}/{topic}", handler, 0)
            self._unsub.append(unsub)
        # Even if no response arrives, entities stay unavailable rather than faking a value.
        await self.async_refresh()

    async def _async_update_data(self) -> dict[str, Any]:
        await mqtt.async_publish(self.hass, f"{self.mac}/{TOPIC_WORK}", "", qos=0, retain=False)
        await mqtt.async_publish(self.hass, f"{self.mac}/{TOPIC_TEMPERATURES}", "", qos=0, retain=False)
        self._schedule_api_check()
        return build_values(self.work, self._fresh_temperatures()) if self.is_fresh else build_values(None, None)

    def _schedule_api_check(self) -> None:
        """HTTP status is supplemental; its failure must never break MQTT polling."""
        if self._stopped or not self.host:
            return
        # Legacy config entries were created before REQ-005 validation existed.
        # Never make HTTP requests to a stored non-RFC1918 target, including
        # special IPs; MQTT polling and control are deliberately unaffected.
        if not is_allowed_lan_ipv4(self.host):
            self.api_error = "Niedozwolony adres lokalnego API REQNET (wymagany prywatny IPv4 LAN)"
            self.api_info = {}
            return
        now = monotonic()
        if self._api_task is not None and not self._api_task.done():
            return
        if self._last_api_poll_at is not None and now - self._last_api_poll_at < 600:
            return
        self._last_api_poll_at = now
        self._api_task = self.hass.async_create_task(self._refresh_api_info())

    async def _refresh_api_info(self) -> None:
        # Defense in depth for direct calls, not only the periodic scheduler.
        if not self.host or not is_allowed_lan_ipv4(self.host):
            self.api_error = "Niedozwolony adres lokalnego API REQNET (wymagany prywatny IPv4 LAN)"
            self.api_info = {}
            return
        self.api_last_attempt = datetime.now(timezone.utc)
        try:
            session = async_get_clientsession(self.hass)
            async with session.get(
                f"http://{self.host}/API/RunFunction",
                params={"name": "API"},
                timeout=aiohttp.ClientTimeout(total=7),
                allow_redirects=False,
            ) as response:
                response.raise_for_status()
                info = await response.json(content_type=None)
            if not isinstance(info, dict) or info.get("APIResult") is not True:
                raise ValueError("APIResult is not true")
            if not info.get("MAC") or normalize_mac(str(info["MAC"])) != self.mac:
                raise ValueError("Device MAC does not match config entry")
            # Only read-only, non-secret fields intended for the diagnostics dialog.
            fields = ("DeviceType", "RecuperatorSoftwareVersion", "APIVersion",
                      "WIFIIP", "WIFISignalStrength", "WIFIStatus", "MQTTStatus")
            self.api_info = {field: info.get(field) for field in fields}
            self.api_last_success = datetime.now(timezone.utc)
            self.api_error = None
        except asyncio.CancelledError:
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, TypeError):
            self.api_error = "Nie udało się odczytać lokalnego API REQNET"
            # Old successful metadata remains identifiable as historical, not live.
        finally:
            if not self._stopped:
                self.async_set_updated_data(
                    build_values(self.work, self._fresh_temperatures())
                    if self.is_fresh else build_values(None, None)
                )

    def _fresh_temperatures(self) -> dict | None:
        if self.last_temp_at is not None and monotonic() - self.last_temp_at < STALE_SECONDS:
            return self.temperatures
        return None

    @callback
    def _handle_work(self, message: mqtt.ReceiveMessage) -> None:
        if getattr(message, "retain", False):
            return  # Retained snapshots can be arbitrarily old.
        try:
            parsed = decode_work(message.payload)
        except (ValueError, TypeError, KeyError, UnicodeError, json.JSONDecodeError, RecursionError, OverflowError):
            _LOGGER.warning("Ignoring malformed CurrentWorkParametersResult")
            return
        self.work = parsed
        self.last_work_at = monotonic()
        self.last_work_utc = datetime.now(timezone.utc)
        self.async_set_updated_data(build_values(self.work, self._fresh_temperatures()))
        # Only a new non-retained, valid response can satisfy a command.
        waiter = self._command_waiter
        if (waiter is not None and not waiter.done() and
                self._command_function is not None and
                command_matches_work(self._command_function, self._command_payload,
                                     parsed, self._command_before)):
            waiter.set_result(True)

    @callback
    def _handle_temperatures(self, message: mqtt.ReceiveMessage) -> None:
        if getattr(message, "retain", False):
            return
        try:
            parsed = decode_temperatures(message.payload)
        except (ValueError, TypeError, KeyError, UnicodeError, json.JSONDecodeError, RecursionError, OverflowError):
            _LOGGER.warning("Ignoring malformed CurrentTemperaturesResult")
            return
        self.temperatures = parsed
        self.last_temp_at = monotonic()
        if self.is_fresh:
            self.async_set_updated_data(build_values(self.work, self._fresh_temperatures()))

    def _command_state(self, function: str, status: str, detail: str) -> None:
        self.last_command = function
        self.last_command_at = datetime.now(timezone.utc)
        self.last_command_status = status
        self.last_command_detail = detail
        self.async_set_updated_data(
            build_values(self.work, self._fresh_temperatures())
            if self.is_fresh else build_values(None, None)
        )

    async def command(self, function: str, payload: dict | str = "") -> None:
        """Publish once, then demand observed state from a NEW non-retained reply.

        A read-only query can be retried. A state-changing command NEVER is.
        There is no REQNET sequence/correlation identifier; this is a reported
        state check, not proof that this particular publication caused the state.
        """
        allowed = {
            "TurnOn", "TurnOff", "AutomaticMode", "TurnOnHoliday",
            "ManualMode", "TurnOnAiring", "SetComfortTemperature",
            "SetByPassMode", "ReplaceFilters",
        }
        if function not in allowed:
            raise HomeAssistantError("Nieobsługiwane polecenie REQNET")
        if self._stopped:
            raise HomeAssistantError("Integracja REQNET została zatrzymana")
        if self._command_active:
            raise HomeAssistantError(
                "Inne polecenie REQNET oczekuje na potwierdzenie — nie wysłano nowego polecenia"
            )
        if not self.is_fresh:
            raise HomeAssistantError("Brak aktualnego stanu REQNET — nie wysłano polecenia")
        # Set the interlock synchronously, before the first suspension point.
        self._command_active = True
        waiter = asyncio.get_running_loop().create_future()
        self._command_waiter = None  # arm only after publishing the action
        self._command_function = function
        self._command_payload = payload
        self._command_before = list(self.work) if self.work is not None else None
        attempted = False
        self._command_state(function, "oczekiwanie", "Wysyłanie polecenia")
        try:
            body = json.dumps(payload, separators=(",", ":")) if isinstance(payload, dict) else payload
            attempted = True
            # Publish timeout cannot prove the command was NOT delivered.
            await asyncio.wait_for(
                mqtt.async_publish(self.hass, f"{self.mac}/{function}", body,
                                   qos=0, retain=False), timeout=7,
            )
            # Do not accept a snapshot obtained before the action publish returned.
            self._command_waiter = waiter
            self._command_state(function, "oczekiwanie", "Oczekiwanie na stan urządzenia")
            deadline = monotonic() + COMMAND_CONFIRM_TIMEOUT
            while not waiter.done():
                if self._stopped:
                    raise HomeAssistantError("Integracja zatrzymana podczas potwierdzania")
                # Re-request STATUS, not the actuator command. Responses may come
                # during this await and must already have an armed waiter.
                remaining = deadline - monotonic()
                if remaining <= 0:
                    break
                await asyncio.wait_for(
                    mqtt.async_publish(self.hass, f"{self.mac}/{TOPIC_WORK}", "",
                                       qos=0, retain=False),
                    timeout=min(5, remaining),
                )
                if waiter.done():
                    break
                remaining = deadline - monotonic()
                if remaining <= 0:
                    break
                try:
                    await asyncio.wait_for(asyncio.shield(waiter),
                                           timeout=min(COMMAND_POLL_SECONDS, remaining))
                except asyncio.TimeoutError:
                    pass
            if not waiter.done():
                raise HomeAssistantError(
                    "Brak potwierdzenia stanu REQNET. Polecenie mogło zostać wykonane. "
                    "Sprawdź rzeczywisty stan centrali; nie ponawiaj automatycznie."
                )
            # stop() may fail the waiter during unload, do not claim success.
            waiter.result()
            self._command_state(function, "potwierdzone", "Nowy odczyt potwierdza żądany stan")
        except asyncio.CancelledError:
            self._command_state(function, "niepewne" if attempted else "przerwane",
                                "Przerwano oczekiwanie; wynik polecenia może być nieznany" if attempted
                                else "Nie udało się zakończyć wysyłania polecenia")
            raise
        except Exception as exc:
            self._command_state(function, "niepewne" if attempted else "błąd_wysyłania",
                                str(exc))
            if isinstance(exc, HomeAssistantError):
                raise
            raise HomeAssistantError(
                "Błąd komunikacji MQTT; nie można ustalić, czy polecenie zostało wykonane. "
                "Sprawdź centralę przed kolejną próbą."
            ) from exc
        finally:
            if not waiter.done():
                waiter.cancel()
            self._command_waiter = None
            self._command_function = None
            self._command_payload = ""
            self._command_before = None
            self._command_active = False

    def stop(self) -> None:
        self._stopped = True
        waiter = self._command_waiter
        if waiter is not None and not waiter.done():
            waiter.set_exception(HomeAssistantError(
                "Integracja REQNET zatrzymana podczas oczekiwania na potwierdzenie"
            ))
        if self._api_task is not None and not self._api_task.done():
            self._api_task.cancel()
        for unsubscribe in self._unsub:
            unsubscribe()
        self._unsub.clear()
