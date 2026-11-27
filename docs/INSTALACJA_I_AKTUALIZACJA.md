# Instalacja, aktualizacja i powrót

Pierwsza instalacja: [README](../README.md). Przed zmianami wykonaj pełną kopię zapasową Home Assistant i zachowaj poprzedni katalog integracji oraz ustawienia panelu.

## Aktualizacja ręczna

1. Rozpakuj nową paczkę instalacyjną. Zastąp cały `/config/custom_components/req_rekuperator` folderem `custom_components/req_rekuperator` z paczki. Nie mieszaj plików wersji.
2. Uruchom ponownie HA. W istniejącym zasobie Lovelace ustaw `/req-rekuperator/rekuperator-js.js?v=0112` (moduł JavaScript). Nie dodawaj duplikatu. Odśwież przeglądarkę/aplikację.
3. Sprawdź bieżące odczyty, temperaturę komfortu, ustawienia, wykresy, historię i logi. Nie usuwaj wpisów integracji ani Recorder. Nie zmieniaj działającej konfiguracji brokera.

## Powrót

Przywróć cały zachowany katalog poprzedniej wersji i odpowiadający mu adres zasobu (np. `?v=0111` dla 0.1.11), uruchom ponownie HA i sprawdź odczyty. W razie niespójności odtwórz pełną kopię HA. Powrót z 0.1.12 do 0.1.11 nie został osobno przetestowany. Nie ponawiaj automatycznie poleceń o niepewnym wyniku.
