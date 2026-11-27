# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Pure REQNET protocol parsing and validation, intentionally HA-independent."""
from __future__ import annotations

import json
import math
import re

from .const import BYPASS_LABELS, MODE_LABELS

MAC_PATTERN = re.compile(r"^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$")


def normalize_mac(value: str) -> str:
    """Accept colon, dash or compact MAC; reject malformed topic components."""
    raw = re.sub(r"[^0-9a-fA-F]", "", value.strip()).upper()
    if len(raw) != 12 or not re.fullmatch(r"[0-9A-F]{12}", raw):
        raise ValueError("Invalid MAC address")
    mac = ":".join(raw[i:i + 2] for i in range(0, 12, 2))
    if not MAC_PATTERN.fullmatch(mac):
        raise ValueError("Invalid MAC address")
    return mac


def decode_work(payload: str | bytes) -> list:
    document = json.loads(payload)
    if not isinstance(document, dict) or document.get("CurrentWorkParametersResult") is not True:
        raise ValueError("CurrentWorkParametersResult is not true")
    values = document.get("Values")
    if not isinstance(values, list) or len(values) < 84:
        raise ValueError("REQNET Values requires at least 84 elements")
    return values


def decode_temperatures(payload: str | bytes) -> dict:
    document = json.loads(payload)
    fields = ("IntakeTemp", "SupplyTemp", "ExtractTemp", "LauncherTemp")
    if (not isinstance(document, dict) or document.get("CurrentTemperaturesResult", True) is not True
            or not any(key in document for key in fields)
            or any(isinstance(document[key], (list, dict)) for key in fields if key in document)):
        # Temperature fields are scalars; nested JSON is malformed telemetry,
        # and should not be retained in a coordinator's last sample.
        raise ValueError("Invalid CurrentTemperaturesResult")
    return document


def num(values: list | None, index: int) -> float | None:
    if values is None or len(values) <= index or values[index] is None or isinstance(values[index], bool):
        return None
    try:
        value = float(values[index])
        return value if math.isfinite(value) else None
    except (TypeError, ValueError, OverflowError):
        # An invalid (but JSON-parseable) huge integer is not telemetry.
        return None


def intval(values: list | None, index: int) -> int | None:
    number = num(values, index)
    if number is None or not number.is_integer():
        return None
    return int(number)


def airing_remaining_seconds(work: list | None) -> int | None:
    """Reported time of an active airing cycle; never infer it from the UI.

    REQNET Values[10] selects the active mode; Values[11] and [12] are
    respectively remaining minutes and seconds. A failed/missing reading
    must not be represented as zero (which would imply completion).
    """
    if intval(work, 10) != 4:
        return None
    minutes = intval(work, 11)
    seconds = intval(work, 12)
    if minutes is None or seconds is None or not (0 <= minutes <= 95 and 0 <= seconds < 60):
        return None
    return minutes * 60 + seconds


def build_values(work: list | None, temp: dict | None) -> dict:
    """Return states keyed by logical function, never guess absent measurements."""
    result = {}
    key_map = {
        "aktualna_temperatura": 2, "predkosc_nawiewu": 3,
        "predkosc_wywiewu": 4, "zadany_nawiew_reczny": 5,
        "zadany_wyciag_reczny": 6, "wilgotnosc": 7, "co2": 8,
        "temperatura_komfortu": 67, "moc_wentylatora_nawiewnego": 81,
        "moc_wentylatora_wywiewnego": 82, "dni_do_wymiany_filtrow": 83,
    }
    for key, index in key_map.items():
        result[key] = num(work, index)
    temperatures = {
        "temperatura_czerpnia": ("IntakeTemp", 55),
        "temperatura_wyrzutnia": ("LauncherTemp", 56),
        "temperatura_nawiew": ("SupplyTemp", 57),
        "temperatura_wywiew": ("ExtractTemp", 58),
    }
    for key, (field, index) in temperatures.items():
        value = (temp or {}).get(field)
        parsed = None
        if value is not None and not isinstance(value, bool):
            try:
                candidate = float(value)
                if math.isfinite(candidate):
                    parsed = candidate
            except (ValueError, TypeError, OverflowError):
                pass
        # Work payload has matching temp fields, used when separate temp response is absent.
        result[key] = parsed if parsed is not None else num(work, index)
    mode = intval(work, 10)
    bypass = intval(work, 39)
    heater = intval(work, 72)
    power = intval(work, 0)
    result["aktualny_tryb"] = MODE_LABELS.get(mode, f"Nieznany ({mode})" if mode is not None else None)
    result["stan_bypassu"] = BYPASS_LABELS.get(bypass)
    result["grzalka_wstepna"] = heater == 1 if heater in (0, 1) else None
    result["przewietrzanie_pozostalo_sekund"] = airing_remaining_seconds(work)
    result["zasilanie"] = power == 1 if power in (0, 1) else None
    result["status_komunikat"] = (
        "Urządzenie włączone" if power == 1 else "Urządzenie wyłączone" if power == 0 else None
    )
    supply_power = result["moc_wentylatora_nawiewnego"]
    extract_power = result["moc_wentylatora_wywiewnego"]
    combined_power = (supply_power + extract_power) if supply_power is not None and extract_power is not None else None
    result["sumaryczny_pobor_mocy"] = (
        round(combined_power) if combined_power is not None and math.isfinite(combined_power) else None
    )
    intake = result["temperatura_czerpnia"]
    supply = result["temperatura_nawiew"]
    extract = result["temperatura_wywiew"]
    efficiency = None
    if all(x is not None for x in (intake, supply, extract)) and bypass in (0, 2) and heater == 0:
        delta = extract - intake
        if abs(delta) >= 3.0:
            estimate = (supply - intake) / delta * 100
            if 0 <= estimate <= 100:
                efficiency = round(estimate)
    result["sprawnosc"] = efficiency
    result["max_airflow"] = num(work, 1)
    result["mode_code"] = mode
    result["bypass_code"] = bypass
    result["grzalka_code"] = heater
    result["error_code"] = intval(work, 40)
    result["message_code"] = intval(work, 41)
    return result


# Confirm a *subsequent* CurrentWorkParametersResult, never the MQTT publish.
# REQNET provides no command correlation id or explicit acknowledgement topic;
# this verifies reported state, not causal execution of the command.
def command_matches_work(function: str, payload: dict | str, work: list | None,
                         before: list | None = None) -> bool:
    """Whether a new, validated device snapshot shows the requested effect.

    A one-shot filter reset is confirmed only by a visible increase in the
    device's days-to-change reading; no inferred 90-day reset is assumed.
    """
    if work is None:
        return False
    mode = intval(work, 10)
    if function == "TurnOn":
        return intval(work, 0) == 1
    if function == "TurnOff":
        return intval(work, 0) == 0
    if function == "AutomaticMode":
        return mode == 9
    if function == "TurnOnHoliday":
        return mode == 3
    if function == "ManualMode":
        return (isinstance(payload, dict) and mode == 8 and
                num(work, 5) == payload.get("airflowvalue") and
                num(work, 6) == payload.get("valueofairextraction"))
    if function == "TurnOnAiring":
        if not isinstance(payload, dict) or mode != 4:
            return False
        seconds = airing_remaining_seconds(work)
        requested = payload.get("time")
        return (isinstance(requested, int) and not isinstance(requested, bool) and
                seconds is not None and 0 < seconds <= requested * 60)
    if function == "SetComfortTemperature":
        return (isinstance(payload, dict) and
                num(work, 67) is not None and
                isinstance(payload.get("temperature"), (int, float)) and
                not isinstance(payload.get("temperature"), bool) and
                abs(num(work, 67) - payload["temperature"]) <= 0.1)
    if function == "SetByPassMode":
        if not isinstance(payload, dict):
            return False
        requested = payload.get("mode")
        state = intval(work, 39)
        # Auto may report closed (2) or open (3), depending on the damper.
        return state in ((2, 3) if requested == 2 else (requested,))
    if function == "ReplaceFilters":
        old = num(before, 83)
        new = num(work, 83)
        return old is not None and new is not None and new >= old + 1
    return False
