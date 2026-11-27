# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""REQ-011: DeviceType display is read-only and never guesses a commercial model.

Executes in a mocked Home Assistant / Chromium environment (no REQNET commands).
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent
html = (root / 'browser_harness.html').read_text(encoding='utf-8')
js = (root.parent / 'www' / 'rekuperator-js.js').read_text(encoding='utf-8')
html = html.replace('<script src="../www/rekuperator-js.js"></script>', '<script>' + js + '</script>')

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True, executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,
        args=['--no-sandbox'])
    for width in (320, 390, 1680):
        page = browser.new_page(viewport={'width': width, 'height': 900})
        js_errors = []
        page.on('pageerror', lambda err: js_errors.append(str(err)))
        page.set_content(html, wait_until='load')
        card = page.locator('req-rekuperator-card')
        page.evaluate('''() => {
          const entry = 'demo-integration-entry';
          window.TEST.hass.states['sensor.my_req_diagnostyka'] = {
            state: 'Połączono', attributes: {
              reqnet_entry_id: entry, reqnet_key: 'diagnostyka',
              reqnet_api_last_success: '2026-11-24T11:52:00Z',
              reqnet_api_error: null,
              reqnet_api_info: {DeviceType: 6, RecuperatorSoftwareVersion: '9.25', APIVersion: 113}
            }
          };
          window.TEST.ctl.hass = window.TEST.hass;
        }''')
        card.locator('[data-action="settings"]').click()
        card.locator('#settings-tab-rekuperator').click()
        card.locator('[data-action="settings-info-toggle"]').click()
        rows = card.locator('#settings-info .settings-item')
        assert rows.count() == 8, rows.count()
        assert rows.first.locator('span').inner_text() == 'Typ urządzenia (DeviceType)'
        assert rows.first.locator('strong').inner_text() == '6'
        assert '9.25' in card.locator('#settings-info').inner_text()
        assert 'Model rekuperatora' not in card.locator('#settings-info').inner_text()

        # Absent metadata, but MQTT connected: never derive a model or type.
        page.evaluate('''() => {
          const d = window.TEST.hass.states['sensor.my_req_diagnostyka'];
          d.attributes.reqnet_api_info = {};
          d.attributes.reqnet_api_last_success = null;
          window.TEST.ctl.hass = window.TEST.hass;
        }''')
        assert rows.first.locator('strong').inner_text() == 'Brak danych'

        # A cached value with HTTP error cannot appear as a fresh DeviceType.
        page.evaluate('''() => {
          const d = window.TEST.hass.states['sensor.my_req_diagnostyka'];
          d.attributes.reqnet_api_info = {DeviceType: 6};
          d.attributes.reqnet_api_last_success = '2026-11-24T10:00:00Z';
          d.attributes.reqnet_api_error = 'Błąd HTTP';
          window.TEST.ctl.hass = window.TEST.hass;
        }''')
        assert rows.first.locator('strong').inner_text() == 'Brak danych'

        # 0 is a valid protocol identifier; invalid shapes must not be rendered.
        page.evaluate('''() => {
          const d = window.TEST.hass.states['sensor.my_req_diagnostyka'];
          d.attributes.reqnet_api_error = null;
          d.attributes.reqnet_api_info = {DeviceType: 0};
          window.TEST.ctl.hass = window.TEST.hass;
        }''')
        assert rows.first.locator('strong').inner_text() == '0'
        page.evaluate('''() => {
          const d = window.TEST.hass.states['sensor.my_req_diagnostyka'];
          d.attributes.reqnet_api_info = {DeviceType: '<img src=x onerror=alert(1)>'};
          window.TEST.ctl.hass = window.TEST.hass;
        }''')
        assert rows.first.locator('strong').inner_text() == 'Brak danych'
        assert card.locator('#settings-info img').count() == 0
        assert not js_errors, js_errors
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), width
        print('DeviceType read-only/regression', width, 'PASS')
        page.close()
    browser.close()
