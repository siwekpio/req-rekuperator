# Instalacja, aktualizacja i powrót

Pierwsza instalacja: [README](../README.md). Przed zmianami wykonaj pełną kopię zapasową Home Assistant i zachowaj poprzedni katalog integracji oraz ustawienia panelu.

## Aktualizacja przez Marketplace (zalecana dla instalacji zarządzanych przez Marketplace)

1. Wykonaj pełną kopię HA wraz z konfiguracją, historią i plikami integracji. Własne repozytorium dodane z linku wymaga działającego połączenia GitHub, aby otrzymywać aktualizacje.
2. W **Ustawienia → Aktualizacje** wybierz dostępne stabilne wydanie Rekuperator reQ i potwierdź aktualizację. Uruchom ponownie HA.
3. Zmień istniejący zasób Lovelace na `/req-rekuperator/rekuperator-js.js?v=0114` (moduł JavaScript), bez duplikatu. Odśwież przeglądarkę/aplikację.
4. Sprawdź wersję, liczbę urządzeń i encji, odczyty, komfort, panel, wykresy, historię oraz logi. Nie zmieniaj MQTT ani wpisów integracji.

Aby przejść z instalacji ręcznej na Marketplace, po backupie dodaj repozytorium zgodnie z README i zainstaluj właściwe wydanie bez usuwania konfiguracji integracji. Nie usuwaj i nie dodawaj urządzeń na nowo. Przerwij w razie konfliktu. Przejęcie ręcznej instalacji 0.1.12 zostało sprawdzone w środowisku testowym.

## Aktualizacja ręczna

1. Rozpakuj nową paczkę instalacyjną. Zastąp cały `/config/custom_components/req_rekuperator` folderem `custom_components/req_rekuperator` z paczki. Nie mieszaj plików wersji.
2. Uruchom ponownie HA. W istniejącym zasobie Lovelace ustaw `/req-rekuperator/rekuperator-js.js?v=0114` (moduł JavaScript). Nie dodawaj duplikatu. Odśwież przeglądarkę/aplikację.
3. Sprawdź bieżące odczyty, temperaturę komfortu, ustawienia, wykresy, historię i logi. Nie usuwaj wpisów integracji ani Recorder. Nie zmieniaj działającej konfiguracji brokera.

## Powrót

Dla instalacji zarządzanej przez Marketplace przywróć pełną kopię HA sprzed aktualizacji, obejmującą również stan Marketplace. Nie odinstalowuj skonfigurowanej integracji — może to usunąć jej urządzenia i encje. Nie używaj opcji instalowania innej wersji jako zamiennika backupu.

Dla instalacji ręcznej: przywróć cały zachowany katalog poprzedniej wersji i odpowiadający mu adres zasobu (np. `?v=0113` dla 0.1.13), uruchom ponownie HA i sprawdź odczyty. W razie niespójności odtwórz pełną kopię HA. Cykl 0.1.12 GPL → 0.1.11 MIT → 0.1.12 GPL został sprawdzony w środowisku testowym Home Assistant: zachowano konfigurację, encje i historię. Test miał charakter odczytowy, bez fizycznych poleceń sterujących. Nie gwarantuje zgodności wszystkich konfiguracji i modeli. Nie ponawiaj automatycznie poleceń o niepewnym wyniku.

[Oficjalna instrukcja Marketplace](https://www.home-assistant.io/integrations/marketplace/).
