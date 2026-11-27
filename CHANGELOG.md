# Historia zmian / Changelog

## 0.1.14 — zgodność katalogu Marketplace / Marketplace catalog compatibility

- Przeniesiono dokumenty BRANDING PL/EN z `brand/` do katalogu komponentu; grafiki i warunki licencji pozostają identyczne.
- Dodano lokalny test zawartości `brand/` i rygorystyczną kontrolę ostrzeżeń BRAND_IMAGES w CI.
- Zaktualizowano oznaczenia wersji i odnośniki licencyjne. Bez zmian funkcjonalnych.

English: Moved branding documents out of `brand/` into the component directory, retaining artwork and license terms; added local brand directory tests and strict BRAND_IMAGES validation in CI; updated version labels and licensing links. No functional changes.

## 0.1.13 — dokumentacja Marketplace / Marketplace documentation

- Marketplace jako zalecana metoda instalacji i aktualizacji; przycisk My Home Assistant w README PL/EN.
- Zachowano instalację ręczną, instrukcję MQTT i wskazówki powrotu z kopii zapasowej.
- Zaktualizowano oznaczenia wersji integracji i kart. Bez zmian funkcjonalnych.

English: Marketplace installation and update guidance, My Home Assistant links in both READMEs, manual installation and MQTT instructions retained, version labels updated; no functional changes.

## 0.1.12 — pierwsze wydanie na GPL v3 / first GPL v3 release

- Monitorowanie i sterowanie rekuperatorem przez MQTT, panel i wykresy historii.
- Poprawiony odczyt nastawy temperatury komfortu, odporność na błędne dane MQTT i uruchamianie integracji.
- Instrukcje PL/EN, konfiguracja MQTT i rzeczywiste zrzuty ekranu.
- Kod na GPL-3.0-only, osobne zasady grafiki i marki.

English: MQTT monitoring and control, dashboard and history charts; improved comfort setpoint reading, handling of invalid MQTT values and setup robustness; bilingual documentation and real screenshots; GPL-3.0-only code with separate branding terms.
