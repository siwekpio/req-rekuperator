# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Browser regression for connectivity loss, recovery, API diagnostics and gear."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent
html=(root/'browser_harness.html').read_text()
js=(root.parent/'www'/'rekuperator-js.js').read_text()
html=html.replace('<script src="../www/rekuperator-js.js"></script>', '<script>'+js+'</script>')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),args=['--no-sandbox'])
    for width in (320,390,1680):
        page=browser.new_page(viewport={'width':width,'height':900})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html,wait_until='load')
        ctl=page.locator('req-rekuperator-card')
        page.evaluate("""() => {
          const diag='sensor.my_req_diagnostyka';
          const time='2026-11-17T10:11:00Z';
          window.TEST.hass.states[diag] = {
            state:'Połączono',attributes:{reqnet_entry_id:'demo-integration-entry',reqnet_key:'diagnostyka',
              reqnet_last_mqtt_response:time,reqnet_api_host:'192.168.4.22',
              reqnet_api_last_success:time,reqnet_api_info:{DeviceType:8,
                RecuperatorSoftwareVersion:'6.26',APIVersion:19,WIFIIP:'192.168.4.22',
                WIFISignalStrength:5,WIFIStatus:'true',MQTTStatus:true}}
          };
          window.TEST.ctl.hass=window.TEST.hass;
        }""")
        ctl.locator('[data-action="settings"]').click()
        ctl.locator('[data-action="settings-tab"][data-settings-tab="rekuperator"]').click()
        ctl.locator('[data-action="settings-info-toggle"]').click()
        txt=ctl.locator('[data-settings-diagnostics]').inner_text()
        assert 'Typ urządzenia (DeviceType)' in txt and '8' in txt and '6.26' in txt and '19' in txt and '5 / 6' in txt and '192.168.4.22' in txt,txt
        size=page.evaluate("""() => getComputedStyle(window.TEST.ctl.shadowRoot.querySelector('.settings-gear svg')).width""")
        assert size=='24px',size
        ctl.locator('[data-action="close"]').click()
        page.evaluate("""() => {
          for(const st of Object.values(window.TEST.hass.states)){
            if(st.attributes.reqnet_key!=='diagnostyka')st.state='unavailable';
          }
          window.TEST.hass.states['sensor.my_req_diagnostyka'].state='Brak odpowiedzi';
          window.TEST.ctl.hass=window.TEST.hass;
          window.TEST.chart.hass=window.TEST.hass;
        }""")
        banner=ctl.locator('[data-status]').inner_text()
        assert 'Brak aktualnej odpowiedzi MQTT' in banner,banner
        assert ctl.locator('[data-action="manual"]').is_disabled()
        assert ctl.locator('[data-action="power"]').is_disabled()
        assert not ctl.locator('[data-action="settings"]').is_disabled()
        ctl.locator('[data-action="settings"]').click()
        txt=ctl.locator('[data-settings-diagnostics]').inner_text()
        assert 'Brak odpowiedzi' in txt and 'Ostatnia odpowiedź MQTT' in txt,txt
        ctl.locator('[data-action="close"]').click()
        page.evaluate("""() => window.TEST.ctl._act('power-confirm',{})""")
        assert len(page.evaluate('window.TEST.calls'))==0
        page.evaluate("""() => {
          window.TEST.hass.states['sensor.my_req_diagnostyka'].state='Połączono';
          for(const st of Object.values(window.TEST.hass.states)){
            if(st.attributes.reqnet_key==='zasilanie')st.state='on';
            if(st.attributes.reqnet_key==='aktualny_tryb')st.state='Tryb ręczny';
            if(st.attributes.reqnet_key==='temperatura_czerpnia')st.state='7.2';
          }
          window.TEST.ctl._lastError=null;
          window.TEST.ctl.hass=window.TEST.hass;
        }""")
        assert not ctl.locator('[data-action="manual"]').is_disabled()
        assert 'Brak aktualnej odpowiedzi MQTT' not in ctl.locator('[data-status]').inner_text()
        assert not errors,errors
        print('Diagnostic/offline/recovery',width,'OK')
        page.close()
    browser.close()
