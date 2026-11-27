# Rekuperator reQ v0.1.14

Wydanie naprawcze zgodności katalogu Marketplace. Dokumenty zasad grafiki PL/EN przeniesiono poza `brand/` do katalogu komponentu, bez zmiany treści i grafik. Dodano kontrolę BRAND_IMAGES oraz zaktualizowano odnośniki licencyjne i oznaczenia wersji. Bez zmian funkcjonalnych.

Przed aktualizacją wykonaj pełny backup HA. Po aktualizacji uruchom ponownie HA, zmień istniejący zasób JavaScript na `/req-rekuperator/rekuperator-js.js?v=0114` i odśwież panel. Nie usuwaj wpisów integracji. [README](README.md) · [Aktualizacja i powrót](docs/INSTALACJA_I_AKTUALIZACJA.md).

English: Marketplace catalog compatibility fix. Branding documents moved outside `brand/` into the component directory; artwork and terms unchanged. Added strict BRAND_IMAGES validation, updated licensing links and version labels. No functional changes. Back up HA, restart after update, update the existing JavaScript module resource to `?v=0114` and refresh the dashboard. Keep integration entries. [English README](README.en.md) · [Update and rollback](docs/INSTALLATION.en.md).
