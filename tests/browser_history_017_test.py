# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""REQ-001: real Chromium, mocked HA states/registry history; no physical device."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent
html = (root/'browser_harness.html').read_text().replace('<script src="../www/rekuperator-js.js"></script>', '<script>'+(root.parent/'www/rekuperator-js.js').read_text()+'</script>')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1280,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    page.evaluate('''() => {
      const {hass,ctl,chart}=TEST;
      const a={}, b={};
      for(const [entity,st] of Object.entries(hass.states)) {
        const key=st.attributes.reqnet_key;
        a[key]=entity;
        const other=entity.replace('my_req_','other_req_'); b[key]=other;
        hass.states[other]={state:'unavailable',attributes:{}};
        st.state='unavailable'; st.attributes={};
      }
      a.diagnostyka='sensor.my_req_diagnostyka'; b.diagnostyka='sensor.other_req_diagnostyka';
      for(const [id,map] of [['demo-integration-entry',a],['other-entry',b]]) {
        hass.states[map.diagnostyka]={state:'Brak odpowiedzi',attributes:{reqnet_entry_id:id,reqnet_key:'diagnostyka',reqnet_entity_map:map}};
      }
      window.historyQueries=[];
      hass.callApi=async(method,query)=>{
        const id=new URLSearchParams(query.split('?')[1]).get('filter_entity_id');
        historyQueries.push(id);
        const t=Date.now()-3600000;
        return [[{state:id.includes('other_req')?'12':'5',last_changed:new Date(t).toISOString()},
                 {state:'unavailable',last_changed:new Date(t+1800000).toISOString()}]];
      };
      ctl.hass=hass; chart.hass=hass;
      chart.setConfig({entry_id:'demo-integration-entry',default_range:'3 dni'});
      window.maps={a,b};
    }''')
    page.wait_for_function('TEST.chart._currentData?.valuePoints > 0', timeout=10000)
    assert all('my_req_' in s for s in page.evaluate('historyQueries'))
    assert page.locator('req-rekuperator-card').locator('[data-action="manual"]').is_disabled()
    # Recreate the card without any prior online state/cache, like browser refresh.
    page.evaluate('''() => {
      TEST.chart.remove(); const chart=document.createElement('req-rekuperator-charts');
      chart.setConfig({entry_id:'other-entry',default_range:'3 dni'});
      document.getElementById('charts').appendChild(chart); historyQueries.length=0;
      chart.hass=TEST.hass; TEST.chart=chart;
    }''')
    page.wait_for_function('TEST.chart._currentData?.valuePoints > 0', timeout=10000)
    queries=page.evaluate('historyQueries')
    assert queries and all('other_req_' in s for s in queries),queries
    # Registry rename while offline must invalidate history mapping/cache.
    page.evaluate('''() => {
      const {hass,chart}=TEST; const b=maps.b;
      const old=b.temperatura_czerpnia; b.temperatura_czerpnia='sensor.renamed_intake';
      delete hass.states[old]; hass.states[b.temperatura_czerpnia]={state:'unavailable',attributes:{}};
      historyQueries.length=0; chart.hass=hass;
    }''')
    page.wait_for_function('historyQueries.includes("sensor.renamed_intake") && TEST.chart._currentData?.valuePoints > 0', timeout=10000)
    assert 'sensor.other_req_temperatura_czerpnia' not in page.evaluate('historyQueries')
    # No automatic selection if two config entries exist.
    page.evaluate('''() => { historyQueries.length=0; TEST.chart.setConfig({}); }''')
    assert not page.evaluate('historyQueries')
    assert not page.evaluate('TEST.chart._currentData')
    # Popup history uses the same offline mapping.
    page.evaluate('historyQueries.length=0')
    page.locator('req-rekuperator-card').locator('[data-entity="sensor.rekuperator_temperatura_czerpnia"]').click()
    page.wait_for_function('historyQueries.includes("sensor.my_req_temperatura_czerpnia")', timeout=10000)
    assert not errors,errors
    print('REQ-001 offline history, fresh card, isolation, rename, ambiguity, popup: OK')
    browser.close()
