# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""REQ-004: Chromium checks 1-day/custom smoothing and raw tooltip data.

Uses an in-browser instance of the real 0.1.8 custom chart implementation.
No connection to a physical device or Home Assistant Recorder.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent
html = (root/'browser_harness.html').read_text().replace(
    '<script src="../www/rekuperator-js.js"></script>',
    '<script>'+(root.parent/'www/rekuperator-js.js').read_text()+'</script>')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1280,'height':900}, timezone_id='Europe/Warsaw')
    errors=[]
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.set_content(html)
    outcomes = page.evaluate('''() => {
      const chart=TEST.chart;
      const t=Date.now()-1000*60*90;
      const series={entity:'sensor.req_intake',type:'line',unit:'°C',color:'#0af',name:'Czerpnia'};
      const area={...series,entity:'sensor.req_bypass',type:'area'};
      const definition={id:'temperatures',series:[series]};
      const points=[20,30,10,40,15,null,50,10,25].map((v,i)=>({time:t+i*60000,value:v}));
      const payload={bucketMs:60000,data:new Map([[series.entity,points],[area.entity,points]])};
      chart._range='1 dzień';
      const predef=chart._displayPoints(definition,series,payload).map(p=>p.value);
      chart._range='Od–do';chart._customRange={start:new Date(t),end:new Date(t+86400000)};
      const custom=chart._displayPoints(definition,series,payload).map(p=>p.value);
      if(JSON.stringify(predef)!==JSON.stringify(custom)) throw Error('1-day preset vs custom differ');
      if(predef[1]!==25 || predef[2]!==20 || predef[6]!==50 || predef[7]!==30) throw Error('trailing/reset incorrectly calculated');
      if(points[1].value!==30 || points[6].value!==50) throw Error('raw payload changed');
      if(custom[5]!==null) throw Error('unknown gap filled');
      if(chart._displayPoints(definition,area,payload)!==points) throw Error('area smoothing');
      for(const range of ['1 dzień','Od–do']) {
        chart._range=range;
        const fifteen={bucketMs:15*60000,data:new Map([[series.entity,points]])};
        if(chart._displayPoints(definition,series,fifteen)!==points) throw Error('15min changed');
        const thirty={bucketMs:30*60000,data:new Map([[series.entity,points]])};
        if(chart._displayPoints(definition,series,thirty)!==points) throw Error('30min changed');
      }
      // Calendar-day thresholds must remain stable across DST transitions.
      for(const [from,to,n] of [['2026-10-25','2026-10-26',60000],
                                ['2026-03-29','2026-03-30',60000],
                                ['2026-10-24','2026-10-27',15*60000],
                                ['2026-10-24','2026-10-31',30*60000]]) {
        chart._range='Od–do';
        chart._customRange={start:new Date(from+'T00:00:00'),end:new Date(to+'T00:00:00')};
        if(chart._bucketMs()!==n) throw Error('wrong DST bucket '+from+'-'+to);
      }
      const other={id:'custom-chart',series:[series]};
      if(chart._displayPoints(other,series,payload)!==points) throw Error('custom chart changed');
      const jump=[{time:t,value:10},{time:t+60000,value:20},{time:t+60000*5,value:40}];
      const gpayload={bucketMs:60000,data:new Map([[series.entity,jump]])};
      if(chart._displayPoints(definition,series,gpayload)[2].value!==40) throw Error('gap not preserved');
      // Tooltip still uses real raw values, even though canvas shows smoothed points.
      chart._plot={left:0,right:800,top:0,bottom:400,width:800,height:400};
      chart._currentData={...payload,bounds:{start:new Date(t),end:new Date(t+8*60000)},sampledUntil:Date.now()};
      chart._config={charts:[definition]};chart._chartIndex=0;
      chart._viewport=null;
      const hovered=800/8; // timestamp at point #1
      chart._showTooltip(hovered, 200);
      const text=chart.shadowRoot.querySelector('.tooltip')?.textContent || '';
      if(!text.includes('30')) throw Error('tooltip not raw '+text);
      if(text.includes('25 °C')) throw Error('tooltip smoothed '+text);
      chart._hideTooltip();
      return {preset:predef,custom,tooltip:text};
    }''')
    assert not errors, errors
    assert outcomes['preset']==outcomes['custom'], outcomes
    print('REQ-004 one-day custom/preset equality, long bucket preservation, null/gap, area, tooltip: OK')
    browser.close()
