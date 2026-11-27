# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Constants for reQ REQNET integration; no installation-specific identifiers."""
from homeassistant.const import Platform
DOMAIN = "req_rekuperator"
PLATFORMS = [Platform.SENSOR, Platform.BINARY_SENSOR, Platform.NUMBER, Platform.SWITCH, Platform.BUTTON]
CONF_MAC = "mac"
CONF_HOST = "host"
TOPIC_WORK = "CurrentWorkParameters"
TOPIC_TEMPERATURES = "CurrentTemperatures"
WORK_RESULT = "CurrentWorkParametersResult"
TEMPERATURES_RESULT = "CurrentTemperaturesResult"
SCAN_INTERVAL_SECONDS = 30
STALE_SECONDS = 150
COMMAND_CONFIRM_TIMEOUT = 24  # s; no automatic command retries
COMMAND_POLL_SECONDS = 3  # read-only requests while confirming

MODE_LABELS = {
    1: "Szybkie grzanie", 2: "Szybkie chłodzenie", 3: "Urlop",
    4: "Przewietrzanie", 5: "Oczyszczanie", 6: "Kominek",
    8: "Tryb ręczny", 9: "Tryb inteligentny", 10: "Pomiar wydajności",
}
BYPASS_LABELS = {
    0: "Zamknięty (Ręcznie)", 1: "Otwarty (Ręcznie)",
    2: "Zamknięty (Auto)", 3: "Otwarty (Auto)",
}
# Stable keys for the Lovelace card. Entity IDs themselves are deliberately not fixed.
SENSOR_SPECS = {
    "temperatura_czerpnia": ("Temperatura Czerpnia", "°C", "temperature"),
    "temperatura_nawiew": ("Temperatura Nawiew", "°C", "temperature"),
    "temperatura_wywiew": ("Temperatura Wywiew", "°C", "temperature"),
    "temperatura_wyrzutnia": ("Temperatura Wyrzutnia", "°C", "temperature"),
    "aktualna_temperatura": ("Aktualna Temperatura", "°C", "temperature"),
    "wilgotnosc": ("Wilgotność", "%", "humidity"),
    "co2": ("CO₂", "ppm", "carbon_dioxide"),
    "aktualny_tryb": ("Aktualny Tryb", None, None),
    "przewietrzanie_pozostalo_sekund": ("Przewietrzanie — Pozostało", "s", None),
    "stan_bypassu": ("Stan ByPassu", None, None),
    "temperatura_komfortu": ("Temperatura Komfortu", "°C", "temperature"),
    "moc_wentylatora_nawiewnego": ("Moc Wentylatora Nawiewnego", "W", "power"),
    "moc_wentylatora_wywiewnego": ("Moc Wentylatora Wywiewnego", "W", "power"),
    "predkosc_nawiewu": ("Prędkość Nawiewu", "m³/h", None),
    "predkosc_wywiewu": ("Prędkość Wywiewu", "m³/h", None),
    "status_komunikat": ("Status Komunikat", None, None),
    "dni_do_wymiany_filtrow": ("Dni do Wymiany Filtrów", "d", None),
    "sumaryczny_pobor_mocy": ("Sumaryczny Pobór Mocy", "W", "power"),
    "sprawnosc": ("Sprawność", "%", None),
}
