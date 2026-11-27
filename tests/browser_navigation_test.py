# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""UI regression checks for the navigation and Settings dialog (0.1.3).

Run: python tests/browser_navigation_test.py (requires playwright + Chromium).
No Home Assistant or physical device required.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent
html = (root / 'browser_harness.html').read_text()
js = (root.parent / 'www' / 'rekuperator-js.js').read_text()
html = html.replace('<script src="../www/rekuperator-js.js"></script>', '<script>'+js+'</script>')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None), args=['--no-sandbox'])
    for width in (320, 390, 1680):
        page = browser.new_page(viewport={'width':width,'height':900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_content(html, wait_until='load')
        page.evaluate('''() => { window.__destination=null; window.history.pushState=(a,b,c)=>{window.__destination=c}; }''')
        control = page.locator('req-rekuperator-card')
        assert control.locator('[data-action="settings"]').count() == 1
        assert control.locator('.status [data-action="simulation"]').count() == 0
        assert control.locator('.tile-chart-foot [data-action="charts"]').count() == 1
        # click settings and access the non-device-changing simulation mode
        control.locator('[data-action="settings"]').click()
        assert control.locator('[role="tab"]').all_text_contents() == ['Karta', 'Rekuperator']
        assert control.locator('.settings-section h3').all_text_contents() == ['Karta']
        assert control.locator('#modal-root [data-action="simulation"]').count() == 1
        control.locator('#modal-root [data-action="simulation"]').click()
        assert control.locator('#modal-root').inner_text().find('Test wizualizacji') >= 0
        assert page.evaluate('window.TEST.ctl._simulation.enabled') is True
        control.locator('[data-action="close"]').last.click()
        control.locator('[data-action="settings"]').click()
        assert 'Zakończ test wizualizacji' in control.locator('#modal-root').inner_text()
        control.locator('#modal-root [data-action="simulation"]').click()  # switch simulation off
        assert page.evaluate('window.TEST.ctl._simulation.enabled') is False
        # test sibling nav from arbitrary dashboard route even with 0.1.0 hard-coded sample paths
        page.evaluate("window.TEST.ctl._config.chart_path='/panel-req-public/wykresy'")
        control.locator('[data-action="charts"]').click()
        print('nav target',page.evaluate('window.__destination'),'current',page.evaluate('window.location.pathname'))
        assert page.evaluate('window.__destination').endswith('/wykresy')
        page.evaluate("window.TEST.chart._config.back_path='/panel-req-public/sterowanie'")
        page.locator('req-rekuperator-charts').locator('[data-action="back-to-control"]').click()
        assert page.evaluate('window.__destination').endswith('/sterowanie')
        assert not errors, errors
        info=page.evaluate('''() => ({width: window.innerWidth, overflow:document.documentElement.scrollWidth>window.innerWidth, name:window.customCards.find(x=>x.type==='req-rekuperator-card')?.name})''')
        assert not info['overflow'], info
        assert info['name']=='Rekuperator reQ — sterowanie',info
        print('Navigation+settings',width,info,'OK')
        page.close()
    browser.close()
