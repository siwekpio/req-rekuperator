# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Rekuperator reQ 0.1.3 — settings tabs, accordion and symmetric gear."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent
html=(root/'browser_harness.html').read_text(encoding='utf-8')
js=(root.parent/'www'/'rekuperator-js.js').read_text(encoding='utf-8')
html=html.replace('<script src="../www/rekuperator-js.js"></script>', '<script>'+js+'</script>')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),args=['--no-sandbox'])
    for width in (320,360,390,430,1680):
        page=browser.new_page(viewport={'width':width,'height':900}, device_scale_factor=1)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html,wait_until='load')
        ctl=page.locator('req-rekuperator-card')
        page.evaluate('''() => {
          const diag='sensor.my_req_diagnostyka';
          const time='2026-11-17T10:11:00Z';
          window.TEST.hass.states[diag] = {
            state:'Połączono',attributes:{reqnet_entry_id:'demo-integration-entry',reqnet_key:'diagnostyka',
              reqnet_last_mqtt_response:time,reqnet_api_host:'192.168.4.22',reqnet_api_last_success:time,
              reqnet_api_last_success:time,reqnet_mac:'AA:BB:CC:DD:EE:FF',reqnet_api_info:{DeviceType:8,
                RecuperatorSoftwareVersion:'6.26',APIVersion:19,WIFIIP:'192.168.4.22',
                WIFISignalStrength:5,WIFIStatus:'true',MQTTStatus:true}}
          };
          window.TEST.ctl.hass=window.TEST.hass;
        }''')
        gear=ctl.locator('.settings-gear svg')
        assert gear.count()==1
        size=gear.evaluate('(e)=>({width:getComputedStyle(e).width,height:getComputedStyle(e).height,stroke:getComputedStyle(e).strokeWidth})')
        assert size['width']=='24px' and size['height']=='24px' and size['stroke']=='1.65px',size
        # icon center aligned within its clickable surface
        geom=ctl.locator('.settings-gear').evaluate('''e=>{
          let a=e.getBoundingClientRect(),b=e.querySelector('svg').getBoundingClientRect();
          return {dx:Math.abs((a.x+a.width/2)-(b.x+b.width/2)),dy:Math.abs((a.y+a.height/2)-(b.y+b.height/2))};
        }''')
        assert geom['dx']<1 and geom['dy']<1,geom
        ctl.locator('[data-action="settings"]').click()
        assert ctl.locator('.settings-dialog').count()==1
        assert ctl.locator('[role="tab"]').count()==2
        assert ctl.locator('#settings-tab-karta').get_attribute('aria-selected')=='true'
        assert ctl.locator('text=Wersja karty:').count()==1
        assert ctl.locator('[data-action="simulation"]').count()==1
        # switch, expand, check previously requested fields plus MAC added in 0.1.6
        ctl.locator('#settings-tab-rekuperator').click()
        assert ctl.locator('#settings-tab-rekuperator').get_attribute('aria-selected')=='true'
        assert ctl.locator('text=Informacje o urządzeniu').count()==1
        assert not ctl.locator('#settings-info').is_visible()
        ctl.locator('[data-action="settings-info-toggle"]').click()
        assert ctl.locator('#settings-info').is_visible()
        labels=ctl.locator('.settings-item span').all_inner_texts()
        assert labels==['Typ urządzenia (DeviceType)','Połączenie MQTT','Ostatnia odpowiedź MQTT','Adres IP','Adres MAC','Firmware centrali','Wersja API modułu Wi-Fi','Sygnał Wi-Fi'],labels
        txt=ctl.locator('#settings-info').inner_text()
        assert all(v in txt for v in ['8','Połączono','192.168.4.22','AA:BB:CC:DD:EE:FF','6.26','19','5 / 6']),txt
        assert not any(v in txt for v in ['IP zgłoszone','Wi-Fi wg modułu','MQTT wg modułu'])
        # preserve tab selection and accordion on reopen
        ctl.locator('[data-action="close"]').click()
        ctl.locator('[data-action="settings"]').click()
        assert ctl.locator('#settings-tab-rekuperator').get_attribute('aria-selected')=='true'
        assert ctl.locator('#settings-info').is_visible()
        # toggle close then reopen
        ctl.locator('[data-action="settings-info-toggle"]').click()
        assert not ctl.locator('#settings-info').is_visible()
        ctl.locator('#settings-tab-karta').click()
        assert ctl.locator('[data-action="simulation"]').is_visible()
        assert not errors,errors
        # No horizontal document overflow at narrower widths
        overflow=page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
        assert not overflow,(width,'horizontal overflow')
        # capture preview
        if width in (320,390,1680):
            ctl.locator('[data-action="close"]').click()
            ctl.locator('[data-action="settings"]').click()
            page.screenshot(path=str(root.parent.parent.parent / f'preview_req013_gear_{width}.png'),full_page=True)
            ctl.locator('#settings-tab-rekuperator').click()
            ctl.locator('[data-action="settings-info-toggle"]').click()
            page.screenshot(path=str(root.parent.parent.parent / f'preview_req013_settings_{width}.png'),full_page=False)
        print('settings',width,'PASS')
        page.close()
    browser.close()
