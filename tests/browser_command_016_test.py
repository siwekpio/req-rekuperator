# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""0.1.6 browser regression: pending confirmation and propagated error."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent
html=(root/'browser_harness.html').read_text(encoding='utf-8')
js=(root.parent/'www'/'rekuperator-js.js').read_text(encoding='utf-8')
html=html.replace('<script src="../www/rekuperator-js.js"></script>', '<script>'+js+'</script>')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':800})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load')
    ctl=page.locator('req-rekuperator-card')
    # Simulate an in-flight HA service call which later fails with no ack.
    page.evaluate('''() => {
      window.REJECT=null;
      window.TEST.hass.callService=() => new Promise((resolve,reject)=>{window.REJECT=reject;});
      window.TEST.ctl.hass=window.TEST.hass;
    }''')
    ctl.locator('[data-action="holiday"]').click()
    ctl.locator('[data-action="holiday-confirm"]').click()
    page.wait_for_function('window.REJECT !== null')
    pending=ctl.locator('[data-action="holiday-confirm"]')
    assert pending.is_disabled()
    assert 'Oczekiwanie na centralę' in pending.inner_text()
    page.evaluate('''() => window.REJECT(new Error('Brak potwierdzenia stanu REQNET. Sprawdź centralę.'))''')
    page.wait_for_function('window.TEST.ctl._busy === false')
    assert 'Brak potwierdzenia stanu REQNET' in ctl.locator('.dialog .error').inner_text()
    assert not pending.is_disabled()
    assert pending.inner_text()=='Włącz'
    # After rejected command there must not be an optimistic success / closed dialog.
    assert ctl.locator('.dialog').count()==1
    assert not errors,errors
    page.close()
    browser.close()
    print('0.1.6 browser command feedback PASS')
