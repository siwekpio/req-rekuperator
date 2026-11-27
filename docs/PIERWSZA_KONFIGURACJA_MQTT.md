# MQTT — konfiguracja dodatkowego połączenia REQNET

Podstawowe kroki są w [README](../README.md). Broker działa np. w Home Assistant; moduł REQNET jest klientem MQTT. Jeśli dane już docierają do HA, nie zmieniaj konfiguracji.

## HTTP — pierwsze połączenie

Lokalne API producenta: `/API/RunFunction`, funkcja `ChangeAdditionalBrokerConfiguration`. Parametry: `MQTT_ADDITIONAL_BROKER_ADDRESS`, `MQTT_ADDITIONAL_BROKER_PORT`, `MQTT_ADDITIONAL_BROKER_USER`, `MQTT_ADDITIONAL_BROKER_PASSWORD`. Przykład adresu modułu w dokumentacji producenta: `192.168.7.1` (nie jest uniwersalny).

### Metoda podstawowa — przeglądarka

Postępuj według kroku 2 w [README](../README.md): podstaw własne dane do przykładowego URL, zakoduj znaki specjalne, wyślij tylko raz i sprawdź odpowiedź oraz połączenie z brokerem. Nie odświeżaj strony po wysłaniu. Jeśli połączenie już działa, nie zmieniaj go. Hasło może pozostać w historii przeglądarki, schowku i logach; tryb prywatny nie szyfruje HTTP.

### Alternatywa — konfigurator Python

Opcjonalne narzędzie: uruchom `python tools/configure_mqtt.py` z katalogu rozpakowanej paczki na komputerze z Pythonem 3. Podaj prywatny IPv4 modułu, adres brokera, port, konto i hasło. Skrypt pyta o potwierdzenie `TAK`, nie wypisuje URL ani hasła, nie korzysta z proxy i nie podąża za przekierowaniami. Nie jest uruchamiany przez integrację. **HTTP nie szyfruje hasła, które jest parametrem URL**; używaj wyłącznie zaufanej sieci LAN i osobnego konta MQTT. Urządzenie lub sieć mogą zapisać żądanie. Nie używaj publicznych proxy ani nie publikuj URL.

**Próba bez zmiany urządzenia:** na Windows otwórz PowerShell w katalogu rozpakowanej paczki, sprawdź `py -3 --version`, następnie uruchom `py -3 tools/configure_mqtt.py`. Wprowadź fikcyjne dane z prywatnym IPv4, np. `192.168.7.1`, broker `192.168.1.100`, port `1883`, użytkownik `req_test` i fikcyjne niepuste hasło (podczas wpisywania nie widać znaków). Na pytanie o potwierdzenie wpisz `NIE`. Program zakończy się bez wysyłania żądania. Taka próba sprawdza obsługę programu, nie połączenie z fizycznym urządzeniem. Nie wpisuj `TAK` na działającej centrali tylko w celu testu.

## MQTT — tylko przy istniejącym połączeniu

Jeżeli moduł jest już połączony z brokerem, producent dokumentuje temat `<MAC>/ChangeAdditionalBrokerConfiguration`. Przykładowy JSON (wartości fikcyjne):

```json
{"MQTT_ADDITIONAL_BROKER_ADDRESS":"192.168.1.20","MQTT_ADDITIONAL_BROKER_PORT":1883,"MQTT_ADDITIONAL_BROKER_USER":"req_mqtt","MQTT_ADDITIONAL_BROKER_PASSWORD":"TUTAJ_WLASNE_HASLO"}
```

Publikuj świadomie tylko raz, bez retain. Nie używaj publicznego brokera. Puste parametry wyłączają dodatkowe połączenie — nie stosuj ich przypadkowo. Odpowiedź `ChangeAdditionalBrokerConfigurationResult: true` potwierdza wywołanie API, nie połączenie z brokerem. Sprawdź logi brokera i odczyty MQTT. Brak potwierdzenia nie oznacza braku zmiany; nie ponawiaj automatycznie.

Źródła: [API REQNET](https://portal.inprax.pl/REQNET/OpisyAPI_REQNET?ID_TYPU=9), [MQTT w HA](https://www.home-assistant.io/integrations/mqtt/). Nie zweryfikowano konfiguracji na wszystkich firmware.
