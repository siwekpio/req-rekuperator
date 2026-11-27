# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent
html=(root / 'browser_harness.html').read_text()
js=(root.parent / 'www' / 'rekuperator-js.js').read_text()
html=html.replace('<script src="../www/rekuperator-js.js"></script>', '<script>'+js+'</script>')
with sync_playwright() as p:
  browser = p.chromium.launch(headless=True, executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None), args=['--no-sandbox'])
  for width in (320,390,1680):
    page=browser.new_page(viewport={'width':width,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html, wait_until="load")
    page.wait_for_timeout(900)
    result=page.evaluate('''() => ({
      errorCard:document.querySelector('req-rekuperator-card').shadowRoot.textContent.includes('Brak odczytu'),
      cardActive:!!document.querySelector('req-rekuperator-card').shadowRoot.querySelector('.readout'),
      chartTabs:[...document.querySelector('req-rekuperator-charts').shadowRoot.querySelectorAll('button')].map(x=>x.textContent.trim()).filter(x=>x.includes('Temperatur')||x.includes('Jakość')||x.includes('Przepływ')).slice(0,3),
      horizontalOverflow:document.documentElement.scrollWidth>window.innerWidth,
      selectedEntity:window.TEST.chart._config.charts[0].series.find(s=>s.axis==='left').entity,
      selectId:window.TEST.ctl._resolvedEntryId,
    })''')
    ctl=page.locator('req-rekuperator-card')
    ctl.locator('button').count()
    page.evaluate('''() => window.TEST.ctl.shadowRoot.querySelector('[data-action="manual"]').click()''')
    page.evaluate('''() => window.TEST.ctl.shadowRoot.querySelector('[data-action="manual-confirm"]').click()''')
    page.wait_for_timeout(180)
    calls=page.evaluate('window.TEST.calls')
    print(width, result, 'calls',calls,'pageerrors',errors)
    assert not errors, errors
    assert result['cardActive']
    assert result['selectedEntity'].startswith('sensor.my_req_')
    assert result['selectId']=='demo-integration-entry'
    assert calls and calls[0]['domain']=='req_rekuperator' and calls[0]['service']=='manual_airflow'
    page.evaluate('''() => {
       const root=window.TEST.ctl.shadowRoot;
       root.querySelector('[data-action="airing"]').click();
       root.querySelector('[data-action="airing-confirm"]').click();
    }''')
    page.wait_for_timeout(80)
    page.evaluate('''() => {
      const root=window.TEST.ctl.shadowRoot;
      root.querySelector('[data-action="bypass"]').click();
      root.querySelector('[data-action="bypass-confirm"]').click();
    }''')
    page.wait_for_timeout(80)
    page.evaluate('''() => {
      const root=window.TEST.ctl.shadowRoot;
      root.querySelector('[data-action="auto"]').click();
      root.querySelector('[data-action="auto-confirm"]').click();
    }''')
    page.wait_for_timeout(80)
    calls=page.evaluate('window.TEST.calls')
    assert [call['service'] for call in calls[:4]] == ['manual_airflow','airing','bypass','press'], calls
    assert calls[1]['data']['entry_id']=='demo-integration-entry'
    assert calls[3]['data']['entity_id']=='button.my_req_aktywuj_tryb_inteligentny'
    page.close()
  browser.close()
