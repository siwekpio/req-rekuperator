# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""0.1.10: untrusted HA state must be text, never executable markup.

Runs in a real Chromium browser with fake Home Assistant states. No network or
real REQNET device is accessed, and no commands are sent.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent
html = (root / 'browser_harness.html').read_text(encoding='utf-8')
js = (root.parent / 'www' / 'rekuperator-js.js').read_text(encoding='utf-8')
html = html.replace('<script src="../www/rekuperator-js.js"></script>', '<script>' + js + '</script>')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True,
        executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),
        args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 830})
    page.set_content(html, wait_until='load')
    page.evaluate("""() => {
      const ctl = window.TEST.ctl;
      const st = window.TEST.hass.states['sensor.my_req_temperatura_czerpnia'];
      st.state = '<img src="data:invalid" onerror="window.__reqInjected=1">';
      window.__reqInjected = 0;
      ctl._rendered = false;
      ctl.hass = window.TEST.hass;
    }""")
    page.wait_for_timeout(350)
    result = page.evaluate("""() => ({
      marker: window.__reqInjected,
      imgs: window.TEST.ctl.shadowRoot.querySelectorAll('img[onerror]').length,
      shown: window.TEST.ctl.shadowRoot.querySelector('[data-value="sensor.rekuperator_temperatura_czerpnia"]').textContent,
      calls: window.TEST.calls.length
    })""")
    assert result['marker'] == 0, result
    assert result['imgs'] == 0, result
    assert '<img' in result['shown'] and 'onerror=' in result['shown'], result
    assert result['calls'] == 0, result
    # The second markup insertion point is a flow-rate readout.
    page.evaluate("""() => {
      window.__reqInjected = 0;
      window.TEST.hass.states['sensor.my_req_predkosc_nawiewu'].state =
        '<img src="data:invalid" onerror="window.__reqInjected=2">';
      window.TEST.ctl._rendered = false;
      window.TEST.ctl.hass = window.TEST.hass;
    }""")
    page.wait_for_timeout(200)
    flow_check = page.evaluate("""() => ({
      marker: window.__reqInjected,
      injected: window.TEST.ctl.shadowRoot.querySelectorAll('img[onerror]').length,
      text: window.TEST.ctl.shadowRoot.querySelector('[data-value="sensor.rekuperator_predkosc_nawiewu"]').textContent,
    })""")
    assert flow_check['marker'] == 0 and flow_check['injected'] == 0, flow_check
    assert '<img' in flow_check['text'], flow_check
    # Restore flow before the textContent refresh and numeric display checks.
    page.evaluate("""() => {
      window.TEST.hass.states['sensor.my_req_predkosc_nawiewu'].state = '70';
      window.TEST.ctl.hass = window.TEST.hass;
    }""")
    # Refresh updates use textContent, which must show the same human-readable
    # value, not escaped HTML entities, and remain harmless.
    page.evaluate("""() => {
      window.TEST.ctl._rendered = true;
      window.TEST.ctl.hass = window.TEST.hass;
    }""")
    result = page.evaluate("""() => ({
      marker: window.__reqInjected,
      shown: window.TEST.ctl.shadowRoot.querySelector('[data-value="sensor.rekuperator_temperatura_czerpnia"]').textContent,
      imgs: window.TEST.ctl.shadowRoot.querySelectorAll('img[onerror]').length,
    })""")
    assert result['marker'] == 0 and result['imgs'] == 0, result
    assert '<img' in result['shown'] and '&lt;' not in result['shown'], result
    # Numeric path must preserve normal visual output.
    page.evaluate("""() => {
      window.TEST.hass.states['sensor.my_req_temperatura_czerpnia'].state = '7.2';
      window.TEST.ctl.hass = window.TEST.hass;
    }""")
    assert '7,2 °C' in page.evaluate("""() => window.TEST.ctl.shadowRoot.querySelector('[data-value="sensor.rekuperator_temperatura_czerpnia"]').textContent""")
    browser.close()
    print('XSS render/refresh regression PASS')
