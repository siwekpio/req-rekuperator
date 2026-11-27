# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
import getpass
import ipaddress
import json
import warnings
from urllib.parse import urlencode
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler
from urllib.error import HTTPError, URLError

# Uzupełnij lokalne IP modułu WiFi REQNET (to NIE adres brokera).
modul_ip = input("Prywatny adres IPv4 modułu REQNET: ").strip()
ip = ipaddress.ip_address(modul_ip)
lan = (ipaddress.ip_network("10.0.0.0/8"),
       ipaddress.ip_network("172.16.0.0/12"),
       ipaddress.ip_network("192.168.0.0/16"))
if ip.version != 4 or not any(ip in net for net in lan):
    raise ValueError("Podaj prywatny adres IPv4 urządzenia w sieci LAN")

broker = input("Adres brokera dostępny z rekuperatora: ").strip()
port = int(input("Port brokera [1883]: ").strip() or "1883")
user = input("Użytkownik MQTT: ").strip()
with warnings.catch_warnings():
    warnings.simplefilter("error", getpass.GetPassWarning)
    try:
        password = getpass.getpass("Hasło MQTT / MQTT password (hidden): ")
    except getpass.GetPassWarning:
        raise SystemExit("Brak bezpiecznego wejścia hasła / No secure password input.") from None
if not broker or not user or not password or not 1 <= port <= 65535:
    raise SystemExit("Wymagane: adres, port, użytkownik i hasło / Address, port, username and password required.")

params = {
    "name": "ChangeAdditionalBrokerConfiguration",
    "MQTT_ADDITIONAL_BROKER_ADDRESS": broker,
    "MQTT_ADDITIONAL_BROKER_PORT": port,
    "MQTT_ADDITIONAL_BROKER_USER": user,
    "MQTT_ADDITIONAL_BROKER_PASSWORD": password,
}
confirm = input("UWAGA: zmienisz konfigurację MQTT urządzenia. Wpisz TAK: ")
if confirm != "TAK":
    raise SystemExit("Anulowano bez wysyłania polecenia")

# Bez automatycznego przekierowania (żeby nie wysłać hasła do innego hosta).
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = build_opener(ProxyHandler({}), NoRedirect())
try:
    with opener.open(
        f"http://{modul_ip}/API/RunFunction?{urlencode(params)}", timeout=8
    ) as response:
        result = json.loads(response.read().decode("utf-8"))
except (HTTPError, URLError, TimeoutError, ValueError) as error:
    raise SystemExit(f"Żądanie nie zostało potwierdzone ({type(error).__name__}). "
                     "Sprawdź status urządzenia; NIE ponawiaj automatycznie.") from None

if not isinstance(result, dict):
    raise SystemExit("Nieoczekiwany format odpowiedzi; sprawdź urządzenie, nie ponawiaj automatycznie.")

if result.get("ChangeAdditionalBrokerConfigurationResult") is True:
    print("Wynik API / API result: true. Sprawdź połączenie / Check broker connectivity.")
else:
    raise SystemExit("Brak potwierdzenia / Not confirmed. Sprawdź urządzenie / Check device. Do not retry automatically.")
