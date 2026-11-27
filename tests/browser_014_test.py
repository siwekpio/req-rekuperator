# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""0.1.4 UI validation: ventilation 5-95, centered countdown, filter remaining-days bar.
Local Chromium test with mocked Home Assistant states and service calls.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent
html=(root/'browser_harness.html').read_text(encoding='utf-8')
js=(root.parent/'www/rekuperator-js.js').read_text(encoding='utf-8')
html=html.replace('<script src="../www/rekuperator-js.js"></script>','<script>'+js+'</script>')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),args=['--no-sandbox'])
    for width in (320,390,430,1680):
        page=browser.new_page(viewport={'width':width,'height':900})
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_content(html, wait_until='load')
        ctl=page.locator('req-rekuperator-card')
        meter=ctl.locator('[data-meter="filters"]')
        assert meter.count()==1
        def metric():
            return page.evaluate('''() => {
                const root=window.TEST.ctl.shadowRoot;
                const m=root.querySelector('[data-meter="filters"]');
                return {width:parseFloat(m.querySelector('span').style.width),
                  level:m.classList.contains('no-data'),status:m.getAttribute('aria-valuetext')};
            }''')
        assert abs(metric()['width']-88/90*100)<.01,metric()
        page.evaluate('''() => {
           window.TEST.hass.states['sensor.my_req_dni_do_wymiany_filtrow'].state='45';
           window.TEST.ctl.hass=window.TEST.hass;
        }''')
        assert abs(metric()['width']-50)<.01,metric()
        page.evaluate('''() => {
           window.TEST.hass.states['sensor.my_req_dni_do_wymiany_filtrow'].state='0';
           window.TEST.ctl.hass=window.TEST.hass;
        }''')
        assert metric()['width']==0
        assert meter.locator('span').evaluate('e=>e.style.background')=='rgb(255, 121, 121)'
        page.evaluate('''() => {
           window.TEST.hass.states['sensor.my_req_dni_do_wymiany_filtrow'].state='unavailable';
           window.TEST.ctl.hass=window.TEST.hass;
        }''')
        assert metric()['level'] and 'Brak' in metric()['status']
        page.evaluate('''() => {
           window.TEST.ctl._config.filter_cycle_days=180;
           window.TEST.hass.states['sensor.my_req_dni_do_wymiany_filtrow'].state='45';
           window.TEST.ctl.hass=window.TEST.hass;
        }''')
        assert abs(metric()['width']-25)<.01,metric()
        ctl.locator('[data-action="airing"]').click()
        rang=ctl.locator('[data-control="minutes"] input[type="range"]')
        assert rang.get_attribute('min')=='5'
        assert rang.get_attribute('max')=='95'
        assert ctl.locator('[data-action="preset-time"]').all_text_contents()==['5 min','10 min','15 min','30 min','60 min']
        page.evaluate('''() => {
           const c=window.TEST.ctl;c._draft.minutes='5';c._syncControl('minutes');
        }''')
        assert ctl.locator('[data-control="minutes"] [data-delta="-1"]').is_disabled()
        page.evaluate('''() => {
           const c=window.TEST.ctl;c._draft.minutes='95';c._syncControl('minutes');
        }''')
        assert ctl.locator('[data-control="minutes"] [data-delta="1"]').is_disabled()
        ctl.locator('[data-action="preset-time"][data-value="15"]').click()
        assert rang.input_value()=='15'
        ctl.locator('[data-action="airing-confirm"]').click()
        assert page.evaluate('window.TEST.calls').pop()['data']['minutes']==15
        # In 0.1.5 the countdown is sourced from the last REQNET MQTT response.
        page.evaluate('''() => {
           const c=window.TEST.ctl;
           window.TEST.hass.states['sensor.my_req_aktualny_tryb'].state='Przewietrzanie';
           window.TEST.hass.states['sensor.my_req_przewietrzanie_pozostalo_sekund']={state:'260',
             attributes:{reqnet_entry_id:'demo-integration-entry',
               reqnet_key:'przewietrzanie_pozostalo_sekund',
               reqnet_sample_utc:new Date().toISOString()}};
           c.hass=window.TEST.hass;
        }''')
        timer=ctl.locator('[data-air-countdown-mobile]' if width<500 else '[data-air-countdown]')
        assert timer.is_visible(),(width,'countdown invisible')
        geometry=page.evaluate('''() => {
           const r=window.TEST.ctl.shadowRoot;
           const a=r.querySelector('.main').getBoundingClientRect();
           const b=r.querySelector(window.innerWidth<=600?'[data-air-countdown-mobile]':'[data-air-countdown]').getBoundingClientRect();
           const svg=r.querySelector('.air-svg').getBoundingClientRect();
           return {centerOffset:Math.abs((a.left+a.width/2)-(b.left+b.width/2)),
                   timerBottom:b.bottom,svgTop:svg.top,mainTop:a.top};
        }''')
        assert geometry['centerOffset']<3,(width,geometry)
        if width<500: assert geometry['timerBottom']<=geometry['svgTop']+3,(width,geometry)
        assert not errors,errors
        assert not page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1'),(width,'horizontal overflow')
        if width in (390,1680):
            ctl.locator('[data-action="close"]').count() # harmless
            page.screenshot(path=str(root.parent/f'preview_014_{width}.png'),full_page=True)
        print('0.1.5 legacy/controls browser',width,'PASS',geometry)
        page.close()
    browser.close()
