# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""0.1.5 — cross-client device-based countdown and mobile placement in Chromium."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent
html=(root/'browser_harness.html').read_text(encoding='utf-8')
js=(root.parent/'www/rekuperator-js.js').read_text(encoding='utf-8')
html=html.replace('<script src="../www/rekuperator-js.js"></script>','<script>'+js+'</script>')

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),args=['--no-sandbox'])
    for width in (320,360,390,430,1680):
        page=browser.new_page(viewport={'width':width,'height':880})
        errors=[]
        page.on('pageerror',lambda err:errors.append(str(err)))
        page.set_content(html, wait_until='load')
        ctl=page.locator('req-rekuperator-card')
        # State supplied via HA entity, including a real MQTT response timestamp.
        page.evaluate('''() => {
          const {hass,ctl}=window.TEST;
          hass.states['sensor.my_req_aktualny_tryb'].state='Przewietrzanie';
          hass.states['sensor.my_req_przewietrzanie_pozostalo_sekund']={
            state:'890',attributes:{reqnet_entry_id:'demo-integration-entry',
              reqnet_key:'przewietrzanie_pozostalo_sekund',reqnet_sample_utc:new Date().toISOString()}};
          ctl.hass=hass;
        }''')
        desktop=ctl.locator('[data-air-countdown]')
        mobile=ctl.locator('[data-air-countdown-mobile]')
        if width<=600:
            assert mobile.is_visible() and not desktop.is_visible(),(width,'mobile timer')
            geometry=page.evaluate('''() => {
              const root=window.TEST.ctl.shadowRoot;
              const m=root.querySelector('.main').getBoundingClientRect();
              const a=root.querySelector('[data-air-countdown-mobile]').getBoundingClientRect();
              const l=root.querySelector('.left .readout').getBoundingClientRect();
              const r=root.querySelector('.right .readout').getBoundingClientRect();
              const svg=root.querySelector('.air-svg').getBoundingClientRect();
              return {center:Math.abs(a.x+a.width/2-(m.x+m.width/2)),
                 rightOfLeft:a.x>=l.right-5,leftOfRight:a.right<=r.left+5,
                 beforeSvg:a.bottom<=svg.top+5, y:a.y, width:a.width,marginToSvg:svg.top-a.bottom};
            }''')
            assert geometry['center']<2 and geometry['beforeSvg'],(width,geometry)
            assert geometry['rightOfLeft'] and geometry['leftOfRight'],(width,geometry)
        else:
            assert desktop.is_visible() and not mobile.is_visible(),(width,'desktop timer')
            geometry=None
        assert '14:50' in ctl.locator('[data-air-countdown-mobile]').inner_text(),width
        # Independent card instance (as on another browser) obtains identical time from HA.
        duplicate=page.evaluate('''() => {
          const c=document.createElement('req-rekuperator-card');
          c.setConfig({entry_id:'demo-integration-entry'});
          document.body.appendChild(c);c.hass=window.TEST.hass;
          const txt=c.shadowRoot.querySelector('[data-air-countdown]').textContent;
          c.remove();return txt;
        }''')
        assert '14:50' in duplicate,(width,duplicate)
        # Time is advanced using the device sample, not sessionStorage.
        page.evaluate('''() => {
          const s=window.TEST.hass.states['sensor.my_req_przewietrzanie_pozostalo_sekund'];
          s.attributes.reqnet_sample_utc=new Date(Date.now()-92000).toISOString();
          window.TEST.ctl.hass=window.TEST.hass;
        }''')
        assert '13:18' in mobile.inner_text(),(width,mobile.inner_text())
        # Loss of MQTT never shows guessed time.
        page.evaluate('''() => {
          const h=window.TEST.hass;
          h.states['sensor.my_req_diagnostyka']={state:'Brak odpowiedzi',attributes:{reqnet_entry_id:'demo-integration-entry',reqnet_key:'diagnostyka'}};
          window.TEST.ctl.hass=h;
        }''')
        assert not mobile.is_visible() and not desktop.is_visible(),width
        # Restoration reuses new packet; closing the airing mode hides both counters.
        page.evaluate('''() => {
          const h=window.TEST.hass;
          h.states['sensor.my_req_diagnostyka'].state='Połączono';
          h.states['sensor.my_req_przewietrzanie_pozostalo_sekund'].state='765';
          h.states['sensor.my_req_przewietrzanie_pozostalo_sekund'].attributes.reqnet_sample_utc=new Date().toISOString();
          window.TEST.ctl.hass=h;
        }''')
        assert mobile.is_visible() if width<=600 else desktop.is_visible(),width
        page.evaluate('''() => {
          window.TEST.hass.states['sensor.my_req_aktualny_tryb'].state='Tryb ręczny';
          window.TEST.ctl.hass=window.TEST.hass;
        }''')
        assert not mobile.is_visible() and not desktop.is_visible(),width
        assert not errors,errors
        assert not page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1'),(width,'overflow')
        if width in (320,390,1680):
            page.evaluate('''() => {
              const h=window.TEST.hass;
              h.states['sensor.my_req_aktualny_tryb'].state='Przewietrzanie';
              h.states['sensor.my_req_przewietrzanie_pozostalo_sekund'].state='885';
              h.states['sensor.my_req_przewietrzanie_pozostalo_sekund'].attributes.reqnet_sample_utc=new Date().toISOString();
              window.TEST.ctl.hass=h;
            }''')
            page.screenshot(path=str(root.parent/f'preview_015_{width}.png'),full_page=True)
        print('0.1.5 device countdown browser',width,'OK',geometry)
        page.close()
    browser.close()
