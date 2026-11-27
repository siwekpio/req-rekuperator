# Protokół REQNET — potwierdzony zakres mapowania w Rekuperator reQ

Wartości tablicy `CurrentWorkParametersResult.Values[]` są indeksowane od zera. To zakres własnej implementacji oraz odczytów użytkownika, **nie pełna specyfikacja wszystkich modeli**.

| Indeks | Interpretacja |
|---|---|
| 0 | Zasilanie (0/1) |
| 3 / 4 | Rzeczywisty nawiew / wywiew (m³/h) |
| 5 / 6 | Ręczne nastawy nawiewu / wywiewu (m³/h) |
| 7 / 8 | Wilgotność (%) / CO₂ (ppm) |
| 10 | Tryb pracy (m.in. 3 urlop, 4 przewietrzanie, 8 ręczny, 9 inteligentny) |
| 11 / 12 | Pozostałe minuty / sekundy przewietrzania w trybie 4 |
| 39 | Stan bypassu (0/1 ręczny, 2/3 auto) |
| 55–58 | Czerpnia, wyrzutnia, nawiew, wywiew (°C) |
| 65 / 66 | Procentowa praca wentylatorów, **nie** m³/h |
| 67 | Temperatura komfortu (°C) |
| 72 | Grzałka wstępna (0/1) |
| 81 / 82 | Moc wentylatorów (W) |
| 83 | Dni do wymiany filtrów |

Ponadto `CurrentTemperaturesResult` daje `IntakeTemp`, `LauncherTemp`, `SupplyTemp`, `ExtractTemp`.

## Tematy

- Odczyt: `{MAC}/CurrentWorkParameters` → `{MAC}/CurrentWorkParametersResult`.
- Temperatury: `{MAC}/CurrentTemperatures` → `{MAC}/CurrentTemperaturesResult`.
- Sterowanie obejmuje `TurnOn`, `TurnOff`, `AutomaticMode`, `TurnOnHoliday`, `TurnOnAiring`, `ManualMode`, `SetByPassMode`, `SetComfortTemperature`, `ReplaceFilters`.

Obliczana sprawność: `(nawiew – czerpnia)/(wywiew – czerpnia) × 100%` tylko przy odpowiednich danych, bez aktywnej grzałki lub otwartego bypassu, różnicy temperatur co najmniej 3°C i wyniku 0–100%. Brak wartości nie jest automatycznie zerem.

## Bezpieczeństwo potwierdzeń

Polecenia publikowane jednokrotnie z `retain=false` i QoS0. Integracja weryfikuje obserwowany stan przez nową ramkę MQTT w ciągu 24 s; połączenie pomiędzy poleceniem a zmianą stanu nie jest kryptograficznym ani protokolarnym ACK. Przy wyniku `niepewne` nie ponawiać polecenia bez sprawdzenia stanu.

Źródło techniczne: https://portal.inprax.pl/REQNET/OpisyAPI_REQNET?ID_TYPU=9 (dokumentacja producenta, informacyjnie; brak oficjalnego wsparcia projektu Rekuperator reQ).

## Dodatkowy broker MQTT — kontekst dokumentacyjny

Zgodnie z udostępnionym opisem API producenta moduł WiFi REQNET obsługuje funkcję `ChangeAdditionalBrokerConfiguration` (dostępna od wersji modułu WiFi `0`). Pola: `MQTT_ADDITIONAL_BROKER_ADDRESS`, `MQTT_ADDITIONAL_BROKER_PORT`, `MQTT_ADDITIONAL_BROKER_USER`, `MQTT_ADDITIONAL_BROKER_PASSWORD`. Wywołanie HTTP: `/API/RunFunction?name=ChangeAdditionalBrokerConfiguration` z parametrami; MQTT topic `<MAC>/ChangeAdditionalBrokerConfiguration` z JSON. Wynik: `ChangeAdditionalBrokerConfigurationResult` oraz `Message`. Podanie pustych wartości wyłącza dodatkowe połączenie MQTT. Ten endpoint **zmienia konfigurację**, ale nie jest wywoływany przez integrację. Procedura pierwszej konfiguracji i zagrożenia bezpieczeństwa: [PIERWSZA_KONFIGURACJA_MQTT.md](PIERWSZA_KONFIGURACJA_MQTT.md).
