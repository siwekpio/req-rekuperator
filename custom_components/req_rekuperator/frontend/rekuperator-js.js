/* Copyright (c) 2026 siwekpio; SPDX-License-Identifier: GPL-3.0-only */
/* Rekuperator reQ integration frontend 0.1.12. */
/* Public REQNET adapter. No fixed MAC, entity names or direct MQTT calls. */

// Resolve sibling Lovelace views using the CURRENT dashboard route.
// Older example paths from 0.1.0 are intentionally normalized, so copying
// the sample dashboard with a different URL does not lead to /home/overview.
function reqNavigationTarget(view, configuredPath) {
  const path = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  // Lovelace routes have dashboard slug followed by view slug (or index).
  // A bare dashboard URL has no view segment.
  const inView = segments.length >= 2;
  const base = inView ? '/' + segments.slice(0, -1).join('/') : path;
  const raw = typeof configuredPath === 'string' ? configuredPath.trim() : '';
  // Preserve explicit paths to other destinations. Only the paths from the
  // old sample dashboards are interpreted as the current dashboard's views.
  const samplePath = /^\/panel-(?:req-public|rekuperator)\/(?:sterowanie|wykresy|wykresy-rekuperatora)\/?$/.test(raw);
  if (raw.startsWith('/') && !samplePath) return raw;
  const slug = raw && !raw.startsWith('/') ? raw.replace(/^\/+|\/+$/g, '') : view;
  return (base === '/' ? '' : base) + '/' + slug;
}
function reqNavigateToSibling(view, configuredPath) {
  const target = reqNavigationTarget(view, configuredPath);
  if (window.location.pathname !== target) {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new Event('location-changed'));
  }
}

const REQ_COMPAT_KEYS = Object.freeze({
  'sensor.rekuperator_temperatura_czerpnia':'temperatura_czerpnia',
  'sensor.rekuperator_temperatura_nawiew':'temperatura_nawiew',
  'sensor.rekuperator_temperatura_wywiew':'temperatura_wywiew',
  'sensor.rekuperator_temperatura_wyrzutnia':'temperatura_wyrzutnia',
  'sensor.rekuperator_wilgotnosc':'wilgotnosc',
  'sensor.rekuperator_co2':'co2',
  'sensor.rekuperator_aktualny_tryb':'aktualny_tryb',
  'sensor.rekuperator_stan_bypassu':'stan_bypassu',
  'sensor.rekuperator_temperatura_komfortu':'temperatura_komfortu',
  'sensor.rekuperator_moc_wentylatora_nawiewnego':'moc_wentylatora_nawiewnego',
  'sensor.rekuperator_moc_wentylatora_wywiewnego':'moc_wentylatora_wywiewnego',
  'sensor.rekuperator_predkosc_nawiewu':'predkosc_nawiewu',
  'sensor.rekuperator_predkosc_wywiewu':'predkosc_wywiewu',
  'sensor.rekuperator_sumaryczny_pobor_mocy':'sumaryczny_pobor_mocy',
  'sensor.rekuperator_sprawnosc':'sprawnosc',
  'sensor.rekuperator_diagnostyka':'diagnostyka',
  'sensor.rekuperator_status_komunikat':'status_komunikat',
  'sensor.rekuperator_dni_do_wymiany_filtrow':'dni_do_wymiany_filtrow',
  'number.rekuperator_ustaw_temp_komfortu':'ustaw_temp_komfortu',
  'number.rekuperator_zadany_nawiew_reczny':'zadany_nawiew_reczny',
  'number.rekuperator_zadany_wyciag_reczny':'zadany_wyciag_reczny',
  'switch.rekuperator_zasilanie':'zasilanie',
  'button.rekuperator_aktywuj_tryb_inteligentny':'aktywuj_tryb_inteligentny',
  'button.rekuperator_aktywuj_urlop':'aktywuj_urlop',
  'binary_sensor.rekuperator_grzalka_wstepna':'grzalka_wstepna'
});
const ReqAdapter = {
  select(hass, requested) {
    const entries = Object.entries(hass?.states || {}).filter(([, st]) =>
      st?.attributes?.reqnet_entry_id && st?.attributes?.reqnet_key);
    const ids = [...new Set(entries.map(([, st]) => st.attributes.reqnet_entry_id))];
    const id = requested || (ids.length === 1 ? ids[0] : null);
    const selected = entries.filter(([, st]) => st.attributes.reqnet_entry_id === id);
    const diagnostics = selected.find(([, st]) => st.attributes.reqnet_key === 'diagnostyka');
    const registryMap = diagnostics?.[1]?.attributes?.reqnet_entity_map;
    // A registry map (even empty) is authoritative; don't resurrect a removed
    // or disabled entity from an old state. Legacy backends still work online.
    const byKey = registryMap && typeof registryMap === 'object' && !Array.isArray(registryMap)
      ? Object.fromEntries(Object.entries(registryMap).filter(([, entity]) =>
          typeof entity === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(entity)))
      : Object.fromEntries(selected.map(([entity, st]) => [st.attributes.reqnet_key, entity]));
    const aliases = Object.fromEntries(Object.entries(REQ_COMPAT_KEYS).map(
      ([legacy, key]) => [legacy, byKey[key] || null]));
    return {entryId: id, aliases, byKey, ready: !!id && !!byKey['zasilanie'] && !!byKey['temperatura_czerpnia']};
  },
  resolve(id, selection) {
    return Object.prototype.hasOwnProperty.call(selection?.aliases || {}, id)
      ? selection.aliases[id] : id;
  },
  wrap(hass, selection) {
    const states = new Proxy(hass.states, {
      get(target, key) {
        if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(selection.aliases, key)) {
          return target[selection.aliases[key]];
        }
        return target[key];
      },
      has(target, key) {return typeof key === 'string' && key in selection.aliases
        ? !!selection.aliases[key] : key in target;}
    });
    return Object.assign(Object.create(hass), {states});
  }
};


(()=>{
/* Rekuperator reQ — karta sterowania wykorzystująca encje Home Assistant. */
class RekuperatorCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this._config={}; this._hass=null; this._modal=null; this._draft={}; this._busy=false;
    this._settingsTab='karta'; this._deviceInfoExpanded=false;
    this._simulation={enabled:false,bypass:false,heater:false}; this._rendered=false; this._lastError=null; this._clock=null; this._historyRequest=0;

    this.shadowRoot.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)this._act(b.dataset.action,b);});
    this.shadowRoot.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.metric-tap')){e.preventDefault();this._act('history',e.target);}});
    this.shadowRoot.addEventListener('input',e=>{if(e.target.matches('[data-draft]'))this._setDraftFromInput(e.target);});
    this.shadowRoot.addEventListener('change',e=>{if(e.target.matches('[data-draft]'))this._setDraftFromInput(e.target);});
  }
  connectedCallback(){this._startClock();}
  disconnectedCallback(){if(this._clock){clearInterval(this._clock);this._clock=null; this._historyRequest++;}}
  _startClock(){if(!this._clock)this._clock=setInterval(()=>this._updateCountdown(),1000);}
  _setDraftFromInput(el){
    const key=el?.dataset?.draft;
    if(!key)return;
    this._draft[key]=String(el.value);
    this._syncControl(key);
  }
  _bounds(min,max,step){
    const lo=Number(min),hi=Number(max),inc=Number(step);
    return {min:Number.isFinite(lo)?lo:0,max:Number.isFinite(hi)&&hi>=lo?hi:100,step:Number.isFinite(inc)&&inc>0?inc:1};
  }
  _snap(value,min,max,step){
    const b=this._bounds(min,max,step);
    const n=Number(value);
    const safe=Number.isFinite(n)?n:b.min;
    const steps=Math.round((Math.min(b.max,Math.max(b.min,safe))-b.min)/b.step);
    return Number(Math.min(b.max,b.min+steps*b.step).toFixed(5));
  }
  _syncControl(key){
    const controls=this.shadowRoot.querySelectorAll('[data-control]');
    for(const wrap of controls){
      if(wrap.dataset.control!==key)continue;
      const input=wrap.querySelector('input[type="range"]');
      if(!input)continue;
      const min=Number(input.min),max=Number(input.max),step=Number(input.step);
      const v=this._snap(this._draft[key],min,max,step);
      this._draft[key]=String(v);
      input.value=String(v);
      input.style.setProperty('--percent',String((v-min)/(max-min||1)*100)+'%');
      const value=wrap.querySelector('[data-display]');
      if(value)value.textContent=v.toLocaleString('pl-PL',{maximumFractionDigits:2});
      const minus=wrap.querySelector('[data-delta="-1"]');
      const plus=wrap.querySelector('[data-delta="1"]');
      if(minus)minus.disabled=v<=min;
      if(plus)plus.disabled=v+step>max+1e-6;
    }
  }
  _touchNumber(label,key,value,min,max,step=1,unit=''){
    const b=this._bounds(min,max,step);
    const current=this._snap(value,b.min,b.max,b.step);
    this._draft[key]=String(current);
    const progress=(current-b.min)/(b.max-b.min||1)*100;
    return `<div class="field touch-field" data-control="${this._esc(key)}"><div class="touch-label"><label for="range-${this._esc(key)}">${this._esc(label)}</label><span class="value-unit">${this._esc(unit)}</span></div><div class="touch-row"><button type="button" class="step-btn" data-action="adjust" data-key="${this._esc(key)}" data-delta="-1" aria-label="Zmniejsz ${this._esc(label)}" ${current<=b.min?'disabled':''}>−</button><output for="range-${this._esc(key)}" class="touch-value"><span data-display>${current.toLocaleString('pl-PL',{maximumFractionDigits:2})}</span><small>${this._esc(unit)}</small></output><button type="button" class="step-btn" data-action="adjust" data-key="${this._esc(key)}" data-delta="1" aria-label="Zwiększ ${this._esc(label)}" ${current+b.step>b.max?'disabled':''}>+</button></div><input id="range-${this._esc(key)}" type="range" data-draft="${this._esc(key)}" min="${b.min}" max="${b.max}" step="${b.step}" value="${current}" style="--percent:${progress}%" aria-label="${this._esc(label)}"/><div class="range-limits"><span>${b.min.toLocaleString('pl-PL')} ${this._esc(unit)}</span><span>${b.max.toLocaleString('pl-PL')} ${this._esc(unit)}</span></div></div>`;
  }
  setConfig(config) { this._config={chart_path:'wykresy',airing_default_minutes:15,filter_warning_days:7,filter_cycle_days:90,co2_good_max:800,co2_warning_max:1200,humidity_low:40,humidity_high:60,power_reference_w:200,power_good_max:40,power_warning_max:100,animation_min_seconds:0.8,animation_max_seconds:4.2,flow_max_m3h:370,message_entity:'sensor.rekuperator_status_komunikat',error_entity:'',...config}; this._rendered=false; this._render(); }
  set hass(hass) {
    this._reqSelection = ReqAdapter.select(hass, this._config.entry_id);
    this._resolvedEntryId = this._reqSelection.entryId;
    this._hass = ReqAdapter.wrap(hass, this._reqSelection);
    if(!this._rendered) this._render(); else this._update();
  }
  _actualEntity(id){return ReqAdapter.resolve(id,this._reqSelection);} 
  getCardSize(){return 8;}
  getGridOptions(){return {columns:12,rows:8,min_columns:3,min_rows:5};}
  _state(id){return this._hass?.states?.[id]?.state;}
  _valid(id){const s=this._state(id);return s!==undefined&&!['unknown','unavailable','none',''].includes(String(s).toLowerCase());}
  _value(id, fallback='—'){return this._valid(id)?this._state(id):fallback;}
  _fmt(id, unit='', digits=0){const v=this._state(id);if(!this._valid(id))return '—';const n=Number(v);return (Number.isFinite(n)?n.toLocaleString('pl-PL',{minimumFractionDigits:digits,maximumFractionDigits:digits}):v)+(unit?' '+unit:'');}
  _esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  _mode(){return this._value('sensor.rekuperator_aktualny_tryb','Nieznany');}
  _isOn(){return this._state('switch.rekuperator_zasilanie')==='on';}
  _diagnostics(){
    const entity=this._reqSelection?.byKey?.diagnostyka;
    return entity ? this._hass?.states?.[entity] || null : null;
  }
  _commOffline(){
    const diag=this._diagnostics();
    return !!diag && diag.state==='Brak odpowiedzi';
  }
  _formatTime(value){
    if(!value)return 'brak odczytu';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'brak odczytu':date.toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  _readout(label,id,color,flow){return `<div class="readout ${flow||''}" style="--tone:${color}"><div class="read-label">${label}</div><div class="read-value metric-tap" data-action="history" data-entity="${id}" tabindex="0" role="button" title="Pokaż historię temperatury" data-value="${id}">${this._esc(this._fmt(id,'°C',1))}</div>${flow?`<div class="read-sub" data-value="${flow}">${this._esc(this._fmt(flow,'m³/h'))}</div>`:''}</div>`;}
  _svg(){return `<svg class="air-svg" viewBox="0 0 1000 470" preserveAspectRatio="xMidYMid meet" aria-label="Schemat odzysku ciepła i przepływu powietrza" role="img">
    <defs><linearGradient id="hex" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#223741"/><stop offset=".55" stop-color="#101d27"/><stop offset="1" stop-color="#29463e"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <path class="duct intake" d="M25 115 H285 Q306 115 324 132 L500 235 L675 130 Q690 115 714 115 H975"/>
    <path class="duct extract" d="M25 360 H286 Q308 360 325 343 L500 235 L675 345 Q692 360 714 360 H975"/>
    <path class="duct exhaust" d="M500 235 L675 130 Q690 115 714 115 H975"/>
    <path class="duct supply" d="M500 235 L675 345 Q692 360 714 360 H975"/>
    <g class="heat-exchanger"><path d="M418 52 H582 Q601 52 612 71 L718 217 Q729 235 718 253 L612 400 Q601 418 582 418 H418 Q399 418 388 400 L282 253 Q271 235 282 217 L388 71 Q399 52 418 52Z" fill="url(#hex)" stroke="#4d6b69" stroke-width="5"/><path d="M426 90 H574 L677 235 L574 380 H426 L323 235Z" fill="#101a20" stroke="#49656a" stroke-width="2"/><path d="M425 90 L575 380 M575 90 L425 380 M323 235 H677" stroke="#3d5a5d" stroke-width="8" opacity=".65"/><path d="M426 90 H574 L677 235 L574 380 H426 L323 235Z" fill="none" stroke="#77928b" stroke-width="2" opacity=".5"/></g>
    <path class="flow intake" d="M25 115 H285 Q306 115 324 132 L500 235"/><path class="flow exhaust" d="M500 235 L675 130 Q690 115 714 115 H975"/><path class="flow extract" d="M25 360 H286 Q308 360 325 343 L500 235"/><path class="flow supply" d="M500 235 L675 345 Q692 360 714 360 H975"/>
    <!-- Obejście bypassu: tor czerpnia → nawiew, równoległy do górnego i prawego obrysu wymiennika (odsunięcie ok. 20 jednostek SVG). -->
    <g class="bypass-indicator" data-bypass-indicator opacity="0" aria-label="Bypass otwarty">
      <path class="bypass-halo" d="M25 115 H270 C310 115 339 109 371 58 Q386 30 416 30 H584 Q610 30 627 55 L738 210 Q755 235 738 260 L702 315 C689 337 700 360 740 360 H975"/>
      <path class="bypass-flow" d="M25 115 H270 C310 115 339 109 371 58 Q386 30 416 30 H584 Q610 30 627 55 L738 210 Q755 235 738 260 L702 315 C689 337 700 360 740 360 H975"/>
      <rect x="439" y="-9" width="122" height="27" rx="13" class="bypass-pill"/>
      <text x="500" y="9" class="indicator-text" text-anchor="middle">BYPASS OTWARTY</text>
    </g>
    <g class="heater-indicator" data-heater-indicator opacity="0" transform="translate(-610 -245)" aria-label="Nagrzewnica wstępna aktywna (czerpnia)">
      <circle cx="785" cy="360" r="24" class="heater-halo"/>
      <path class="heater-wave" d="M775 342 C769 348 769 354 775 360 C781 366 781 372 775 378"/>
      <path class="heater-wave" d="M785 340 C779 347 779 354 785 361 C791 368 791 375 785 382"/>
      <path class="heater-wave" d="M795 342 C789 348 789 354 795 360 C801 366 801 372 795 378"/>
    </g>
    <circle cx="500" cy="235" r="11" fill="#d8e4c5" filter="url(#glow)"/>
    <g class="arrow"><path d="M964 104 L978 115 L964 126" stroke="#b98bb9"/><path d="M964 349 L978 360 L964 371" stroke="#82d28b"/></g>
  </svg>`;}
  _render(){if(!this._hass)return;this._rendered=true;this.shadowRoot.innerHTML=`<style>
:host{display:block;width:100%;min-width:0}*{box-sizing:border-box}ha-card{border:0;overflow:hidden;background:radial-gradient(ellipse at 50% 35%,#18262c 0%,#10171c 57%,#0b1015 100%);color:#f2f7fa;min-height:min(850px,calc(100dvh - 70px));height:auto;border-radius:18px;padding:clamp(12px,2vw,26px);font-family:inherit;container-type:inline-size;position:relative}.wrap{min-height:inherit;display:flex;flex-direction:column;gap:clamp(12px,2vh,22px)}.top{display:flex;gap:12px;align-items:center;justify-content:space-between}.modes{display:flex;gap:8px;flex-wrap:wrap}.btn{appearance:none;border:1px solid #33444b;border-radius:12px;background:#1a272e;color:#d9e6eb;font:inherit;padding:11px 15px;cursor:pointer;transition:background .2s,border-color .2s,transform .2s;min-height:44px}.btn:hover{background:#263c44}.btn:active{transform:scale(.98)}.btn.active{background:#20423a;border-color:#8dcbb1;color:#e8fff3}.btn:disabled{opacity:.5;cursor:not-allowed}.power{font-size:23px;width:50px;height:50px;padding:0;border-radius:50%;color:#e9c4b6}.power.on{background:#214e35;border-color:#6ac28a;color:#a5f6c1}.status{display:flex;gap:9px;align-items:center;font-size:12px;color:#a5bac3;flex-wrap:wrap}.dot{width:8px;height:8px;border-radius:50%;background:#b35f55}.dot.on{background:#6bd8a0;box-shadow:0 0 10px #6bd8a0}.main{flex:1;display:grid;grid-template-columns:minmax(135px,1fr) minmax(250px,2.4fr) minmax(135px,1fr);align-items:center;gap:8px;min-height:300px}.side{display:flex;flex-direction:column;justify-content:space-around;align-self:stretch;gap:16px}.side.right{text-align:right}.readout{border-left:3px solid var(--tone);padding:5px 10px}.right .readout{border-left:0;border-right:3px solid var(--tone)}.read-label{color:var(--tone);font-size:clamp(14px,1.7vw,23px);margin-bottom:4px}.read-value{font-size:clamp(24px,3.3vw,48px);font-weight:750;white-space:nowrap;font-variant-numeric:tabular-nums}.read-sub{font-size:clamp(14px,2vw,25px);color:#a8bac6;white-space:nowrap}.visual{min-width:0;position:relative}.air-svg{display:block;width:100%;overflow:visible}.duct{fill:none;stroke-width:11;stroke-linecap:round;opacity:.75}.intake{stroke:#5b9ec5}.extract{stroke:#f7a345}.exhaust{stroke:#b481b6}.supply{stroke:#77c87a}.flow{fill:none;stroke-width:5;stroke-dasharray:3 21;stroke-linecap:round;animation:travel 2s linear infinite;filter:drop-shadow(0 0 4px currentColor)}.flow.intake{color:#6bc4f5}.flow.extract{color:#ffb258}.flow.exhaust{color:#e6a7e2}.flow.supply{color:#8be993}.arrow path{fill:none;stroke-width:8;stroke-linecap:round;stroke-linejoin:round}@keyframes travel{to{stroke-dashoffset:-48}}.off .flow{animation-play-state:paused;opacity:.13}.off .heat-exchanger{opacity:.35}.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.tile{min-width:0;border:1px solid #314149;border-radius:15px;background:linear-gradient(145deg,#18242b,#101a20);padding:clamp(12px,1.6vw,20px);display:flex;flex-direction:column;justify-content:space-between;gap:13px}.tile-label{font-size:clamp(12px,1.3vw,17px);color:#a9bec8}.tile-value{font-size:clamp(21px,2.3vw,32px);font-weight:700;overflow-wrap:anywhere}.tile-foot{border-top:1px solid #304047;padding-top:10px;font-size:clamp(12px,1.1vw,15px);color:#d1e0e5;display:flex;justify-content:space-between;gap:8px;align-items:center}.tile .btn{padding:7px 10px;font-size:13px;min-height:38px}.good{color:#84d4a3}.warn{color:#efb46d}.actions{display:flex;gap:10px;justify-content:flex-end}.actions .btn{min-width:100px}.overlay{position:fixed;inset:0;z-index:10000;background:#000a;display:flex;align-items:center;justify-content:center;padding:18px}.dialog{background:#17242b;border:1px solid #45606b;border-radius:18px;box-shadow:0 25px 80px #000b;color:#f3f7fa;width:min(460px,100%);max-height:90dvh;overflow:auto;padding:24px}.dialog h2{font-size:22px;margin:0 0 16px}.dialog p{color:#b6c8d1}.field{display:grid;gap:8px;margin:15px 0}.field label{font-size:14px;color:#d3e1e7}.field input,.field select{width:100%;accent-color:#79c7a6}.field input[type=number],.field select{padding:12px;background:#0e1b22;border:1px solid #516671;border-radius:10px;color:white;font:inherit}.dialog-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:22px}.primary{background:#236d51;border-color:#4ab98a}.error{color:#ffb6a8;font-size:13px;margin-top:10px}.muted{color:#9eb3bd}.loading{opacity:.65;pointer-events:none}
@container (max-width:820px){ha-card{min-height:0}.main{grid-template-columns:1fr 1fr;gap:14px}.visual{grid-column:1/-1;grid-row:1}.side{grid-row:2;gap:12px}.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.read-value{font-size:clamp(23px,4.5vw,38px)}.read-label{font-size:clamp(13px,2.8vw,19px)}.read-sub{font-size:clamp(13px,2.8vw,20px)}}
@container (max-width:480px){ha-card{padding:12px;border-radius:12px}.top{align-items:flex-start}.modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));flex:1}.modes .btn{padding:9px 5px;font-size:12px}.power{width:46px;height:46px;flex-shrink:0}.main{min-height:0}.visual{margin:0 -5px}.readout{padding:4px 7px}.read-value{font-size:clamp(20px,6vw,29px)}.read-sub{font-size:clamp(12px,3.5vw,17px)}.tiles{gap:8px}.tile{padding:11px;gap:8px}.tile-value{font-size:22px}.tile-foot{align-items:flex-start;flex-direction:column}.actions{justify-content:stretch}.actions .btn{flex:1}}
    /* Awaryjne breakpointy szerokości ekranu dla starszych mobilnych WebView.
       Główna responsywność nadal opiera się na @container. */
    @media screen and (max-width:850px){
      ha-card{min-height:0}
      .main{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;min-height:0}
      .visual{grid-column:1/-1;grid-row:1}
      .side{grid-row:2;gap:12px}
      .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
      .read-value{font-size:clamp(23px,4.5vw,38px)}
      .read-label{font-size:clamp(13px,2.8vw,19px)}
      .read-sub{font-size:clamp(13px,2.8vw,20px)}
    }
    @media screen and (max-width:520px){
      ha-card{padding:12px;border-radius:12px}
      .top{align-items:flex-start}
      .modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));flex:1}
      .modes .btn{padding:9px 5px;font-size:12px}
      .power{width:46px;height:46px;flex-shrink:0}
      .visual{margin:0 -5px}
      .readout{padding:4px 7px}
      .read-value{font-size:clamp(20px,6vw,29px)}
      .read-sub{font-size:clamp(12px,3.5vw,17px)}
      .tiles{gap:8px}
      .tile{padding:11px;gap:8px}
      .air-countdown{top:-2px;left:50%;max-width:96%;font-size:12px;padding:6px 10px}
      .tile-value{font-size:22px}
      .tile-foot{align-items:flex-start;flex-direction:column}
      .actions{justify-content:stretch}
      .actions .btn{flex:1}
    }
    @media(prefers-reduced-motion:reduce){.flow{animation:none}.btn{transition:none}}

/* v1.2: wspólna linia rozdzielająca we wszystkich kafelkach na PC. */
.tiles{align-items:stretch}
.tile{display:grid;grid-template-rows:minmax(0,1fr) auto;justify-content:stretch;gap:0}
.tile-foot{min-height:58px;align-self:end}
/* Status oparty na realnie dostępnych encjach, a nie domniemanych kodach alarmów. */
.status{min-height:34px;display:flex;gap:9px;align-items:center;padding:7px 10px;border:1px solid transparent;border-radius:10px;font-size:13px;line-height:1.4;transition:background .2s,border-color .2s}
.status .dot{flex:0 0 9px;height:9px}
.status.info{color:#b9d6df}
.status.warn{background:#3c2e1d;border-color:#a8763a;color:#ffdfac}
.status.warn .dot{background:#f8bb64;box-shadow:0 0 9px #f8bb6466}
.status.error{background:#482326;border-color:#b9545d;color:#ffd3d5}
.status.error .dot{background:#ff727b;box-shadow:0 0 9px #ff727b77}
.status-msg{flex:1;min-width:0;overflow-wrap:anywhere}
.sim-launch{border:1px solid #537783;background:#20343c;color:#d9f7fa;border-radius:8px;font:inherit;padding:5px 8px;cursor:pointer;min-height:30px;white-space:nowrap}
.sim-launch:hover{background:#31505a}
.simulation-active .heat-exchanger{opacity:1}
.simulation-mark{position:absolute;z-index:2;top:0;right:0;background:#52391c;color:#ffe3b9;padding:4px 7px;border-radius:7px;font-size:11px;font-weight:800;letter-spacing:.03em}
.simulation-mark[hidden]{display:none}
.simulation-choice{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:12px 0}
.simulation-choice button{min-height:48px;padding:9px;border-radius:11px;background:#1c3139;color:#eaf7fa;border:1px solid #49616c;font:inherit;cursor:pointer}
.simulation-choice button.selected{background:#235345;border-color:#78d4ae;color:#fff}
.simulation-note{margin:0 0 10px;color:#ffd695;font-size:13px}
@container (max-width:480px){.sim-launch{padding:4px 6px;font-size:11px}.status-msg{flex-basis:55%}}
.air-countdown{position:absolute;z-index:2;top:0;left:50%;transform:translateX(-50%);white-space:nowrap;max-width:min(96%,460px);overflow:hidden;text-overflow:ellipsis;background:#20483d;border:1px solid #72bd9e;border-radius:12px;color:#e0fff1;font-size:clamp(12px,1.4vw,17px);font-weight:650;padding:7px 13px;box-shadow:0 6px 20px #0005}.air-countdown[hidden]{display:none!important}
.status-close{background:transparent;color:inherit;border:1px solid currentColor;border-radius:8px;min-width:30px;min-height:30px;cursor:pointer;opacity:.9}
.power svg{display:block;width:24px;height:24px}
.label-short{display:none}

@container (max-width:600px){
ha-card{min-height:0!important;height:auto;border-radius:10px;padding:9px!important}
.wrap{gap:8px!important;min-height:0!important}
.top{gap:6px;align-items:center}
.modes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;flex:1;min-width:0}
.modes .btn{font-size:12px;min-height:38px;line-height:1.15;padding:5px 2px;border-radius:9px;white-space:nowrap}
.label-full{display:none}.label-short{display:inline}
.power{height:39px;width:39px;flex:0 0 39px;border-radius:50%;min-height:39px}
.power svg{height:20px;width:20px}
.status{padding:5px 7px;min-height:31px;font-size:11px;gap:6px}
.status .dot{height:7px;flex-basis:7px}
.main{min-height:0!important;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 9px;align-items:stretch}
.main>.side{display:contents}
.main>.left>.readout:first-child{grid-column:1;grid-row:1}
.main>.right>.readout:first-child{grid-column:2;grid-row:1}
.main>.visual{grid-column:1/-1;grid-row:2;width:100%;margin:0;max-width:none}
.main>.left>.readout:last-child{grid-column:1;grid-row:3}
.main>.right>.readout:last-child{grid-column:2;grid-row:3}
.readout{padding:2px 6px;border-width:2px;min-width:0}
.read-label{font-size:12px;margin:0 0 2px}
.read-value{font-size:clamp(20px,6.2vw,25px);line-height:1.18}
.read-sub{font-size:clamp(11px,3.5vw,14px);line-height:1.35;margin-top:2px}
.air-svg{width:100%;max-height:195px}
.tiles{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;align-items:stretch}
.tile{padding:9px;border-radius:11px;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:4px;min-width:0}
.tile-label{font-size:12px;line-height:1.2}
.tile-value{font-size:clamp(18px,5.5vw,23px);line-height:1.15;margin-top:4px}
.tile-foot{font-size:11px;min-height:0;align-self:end;gap:5px;display:flex;flex-direction:column;align-items:stretch;padding-top:6px}
.tile .btn{font-size:11px;min-height:30px;padding:5px 7px;border-radius:8px;line-height:1.1}
.tile:last-child .tile-foot{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.tile:last-child .tile-foot .btn{min-width:0;padding:4px 3px}
.tile-foot span{overflow-wrap:anywhere}
.overlay{padding:10px}
.dialog{padding:18px;max-height:85dvh}
}
@media screen and (max-width:600px){
ha-card{min-height:0!important;height:auto;border-radius:10px;padding:9px!important}
.wrap{gap:8px!important;min-height:0!important}
.top{gap:6px;align-items:center}
.modes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;flex:1;min-width:0}
.modes .btn{font-size:12px;min-height:38px;line-height:1.15;padding:5px 2px;border-radius:9px;white-space:nowrap}
.label-full{display:none}.label-short{display:inline}
.power{height:39px;width:39px;flex:0 0 39px;border-radius:50%;min-height:39px}
.power svg{height:20px;width:20px}
.status{padding:5px 7px;min-height:31px;font-size:11px;gap:6px}
.status .dot{height:7px;flex-basis:7px}
.main{min-height:0!important;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 9px;align-items:stretch}
.main>.side{display:contents}
.main>.left>.readout:first-child{grid-column:1;grid-row:1}
.main>.right>.readout:first-child{grid-column:2;grid-row:1}
.main>.visual{grid-column:1/-1;grid-row:2;width:100%;margin:0;max-width:none}
.main>.left>.readout:last-child{grid-column:1;grid-row:3}
.main>.right>.readout:last-child{grid-column:2;grid-row:3}
.readout{padding:2px 6px;border-width:2px;min-width:0}
.read-label{font-size:12px;margin:0 0 2px}
.read-value{font-size:clamp(20px,6.2vw,25px);line-height:1.18}
.read-sub{font-size:clamp(11px,3.5vw,14px);line-height:1.35;margin-top:2px}
.air-svg{width:100%;max-height:195px}
.tiles{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;align-items:stretch}
.tile{padding:9px;border-radius:11px;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:4px;min-width:0}
.tile-label{font-size:12px;line-height:1.2}
.tile-value{font-size:clamp(18px,5.5vw,23px);line-height:1.15;margin-top:4px}
.tile-foot{font-size:11px;min-height:0;align-self:end;gap:5px;display:flex;flex-direction:column;align-items:stretch;padding-top:6px}
.tile .btn{font-size:11px;min-height:30px;padding:5px 7px;border-radius:8px;line-height:1.1}
.tile:last-child .tile-foot{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.tile:last-child .tile-foot .btn{min-width:0;padding:4px 3px}
.tile-foot span{overflow-wrap:anywhere}
.overlay{padding:10px}
.dialog{padding:18px;max-height:85dvh}
}

/* v1.3: stabilne położenie ON/OFF oraz obsługa dotykowa formularzy. */
.top{display:grid;grid-template-columns:minmax(0,1fr) 52px;gap:12px;align-items:center}
.modes{min-width:0;justify-content:flex-start}
.power{justify-self:center;align-self:center;display:flex;align-items:center;justify-content:center;margin:0;width:50px;height:50px;min-height:50px;min-width:50px;flex:none;line-height:1;padding:0;position:static;transform:none}
.power svg{display:block;flex:none;stroke-linecap:round;stroke-linejoin:round;width:25px;height:25px;margin:0}
.power:active{transform:scale(.97)}
.dialog{width:min(510px,100%);padding:clamp(16px,3vw,24px)}
.touch-field{margin:20px 0 18px;gap:10px}
.touch-label{display:flex;justify-content:space-between;align-items:center;gap:12px}
.touch-label label{font-weight:650;font-size:15px}
.touch-label .value-unit{color:#90aab6;font-size:13px}
.touch-row{display:grid;grid-template-columns:58px minmax(0,1fr) 58px;align-items:center;gap:10px}
.step-btn{display:flex;align-items:center;justify-content:center;height:58px;min-width:0;border:1px solid #557a7c;background:#233942;color:#e5f9fb;border-radius:14px;font-family:inherit;font-size:30px;font-weight:700;line-height:1;touch-action:manipulation;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}
.step-btn:active:not(:disabled){background:#2c5b58}
.step-btn:disabled{opacity:.25;cursor:default}
.touch-value{min-width:0;background:#101e25;border:1px solid #3a5560;border-radius:14px;height:58px;display:flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap;font-size:27px;font-weight:750;font-variant-numeric:tabular-nums}
.touch-value small{font-size:13px;font-weight:500;color:#9cb5c1}
.touch-field input[type="range"]{-webkit-appearance:none;appearance:none;width:100%;height:9px;border-radius:20px;outline:none;cursor:pointer;touch-action:pan-y;margin:10px 0 0;border:0;background:linear-gradient(90deg,#73d5aa 0%,#73d5aa var(--percent),#344d58 var(--percent),#344d58 100%)}
.touch-field input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:30px;height:30px;border-radius:50%;background:#d8fff0;border:4px solid #338868;box-shadow:0 1px 10px #0008;cursor:grab}
.touch-field input[type="range"]::-moz-range-thumb{width:23px;height:23px;border-radius:50%;background:#d8fff0;border:4px solid #338868;box-shadow:0 1px 10px #0008;cursor:grab}
.range-limits{display:flex;justify-content:space-between;color:#829eaa;font-size:12px}
.presets{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.preset-btn{flex:1;min-width:72px;min-height:44px;padding:8px 10px!important}
.match-btn{width:100%;min-height:46px;font-size:13px;white-space:normal}
.choice-grid{display:grid;gap:10px;margin:18px 0 12px}
.choice-btn{display:flex;align-items:center;justify-content:center;text-align:center;min-height:55px;border-radius:12px;background:#1c3038;border:1px solid #3e5864;color:#e1eff1;font-family:inherit;font-size:16px;font-weight:600;line-height:1.3;cursor:pointer;touch-action:manipulation;padding:12px}
.choice-btn.selected{background:#245b47;border-color:#87d0a6;color:#edfff7;box-shadow:inset 0 0 0 1px #60b78b}
.dialog-actions .btn{min-height:46px;flex:1}
@container (max-width:600px){.top{grid-template-columns:minmax(0,1fr) 44px;gap:6px}.power{height:44px;width:44px;min-height:44px;min-width:44px}.power svg{width:23px;height:23px}.dialog{padding:16px}.touch-row{grid-template-columns:54px minmax(0,1fr) 54px;gap:7px}.step-btn,.touch-value{height:55px}.step-btn{font-size:27px}.touch-value{font-size:25px}}
@media screen and (max-width:600px){.top{grid-template-columns:minmax(0,1fr) 44px;gap:6px}.power{height:44px;width:44px;min-height:44px;min-width:44px}.power svg{width:23px;height:23px}.dialog{padding:16px}.touch-row{grid-template-columns:54px minmax(0,1fr) 54px;gap:7px}.step-btn,.touch-value{height:55px}.step-btn{font-size:27px}.touch-value{font-size:25px}}

/* v1.5: kafelek filtrów podzielony na dwie funkcjonalne sekcje. */
.tile-filters .filter-top{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;padding-bottom:10px}
.tile-filters .filter-top .btn{flex-shrink:0}
.tile-chart-foot{display:flex;justify-content:space-between;align-items:center;gap:8px}
.tile-chart-foot .chart-label{display:inline-flex;align-items:center;gap:7px;font-weight:600;white-space:nowrap}
.tile-chart-foot svg{width:22px;height:22px;color:#91c8e1;flex-shrink:0}
@container (max-width:600px){
 .tile-filters .filter-top{align-items:flex-start;flex-direction:column;gap:5px;padding-bottom:6px}
 .tile-filters .filter-top .btn{align-self:stretch;min-width:0}
 .tile-filters .tile-chart-foot{display:flex!important;flex-direction:row;align-items:center;min-width:0}
 .tile-chart-foot .chart-label{font-size:11px;gap:4px}
 .tile-chart-foot svg{width:17px;height:17px}
 .tile-chart-foot .btn{min-width:0}
}
@media screen and (max-width:600px){
 .tile-filters .filter-top{align-items:flex-start;flex-direction:column;gap:5px;padding-bottom:6px}
 .tile-filters .filter-top .btn{align-self:stretch;min-width:0}
 .tile-filters .tile-chart-foot{display:flex!important;flex-direction:row;align-items:center;min-width:0}
 .tile-chart-foot .chart-label{font-size:11px;gap:4px}
 .tile-chart-foot svg{width:17px;height:17px}
}

/* v1.6: spójne ikony SVG i identyczne sekcje kafelków w widoku mobilnym. */
.tile-label{display:flex;align-items:center;gap:7px}
.metric-icon{width:21px;height:21px;flex:0 0 21px;vertical-align:middle}
.tile:nth-child(1) .metric-icon{color:#84d4a3}
.tile:nth-child(2) .metric-icon{color:#f4b36b}
.tile:nth-child(3) .metric-icon{color:#7bbff1}
.tile:nth-child(4) .filter-top .metric-icon{color:#85c9b5}
.tile-chart-foot .metric-icon{color:#91c8e1}
@container (max-width:600px){
  .tiles{grid-auto-rows:1fr;align-items:stretch;gap:7px}
  .tile{grid-template-rows:minmax(105px,1fr) minmax(78px,auto);min-height:192px;gap:0}
  .tile>div:first-child,.tile .filter-top{min-height:0}
  .tile-label{font-size:12px;gap:5px;min-height:20px}
  .metric-icon{width:17px;height:17px;flex-basis:17px}
  .tile-value{margin-top:5px}
  .tile-foot{min-height:0;align-self:stretch;justify-content:space-between;display:flex;flex-direction:column;gap:7px;padding-top:8px}
  .tile-foot .btn{width:100%;min-height:32px}
  .tile-filters .filter-top{display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;gap:6px;padding-bottom:8px}
  .tile-filters .filter-top .btn{width:100%;min-height:32px}
  .tile-filters .tile-chart-foot{display:flex!important;flex-direction:column;align-items:stretch;justify-content:space-between;gap:6px}
  .tile-chart-foot .chart-label{font-size:12px;gap:5px}
  .tile-chart-foot .btn{width:100%;min-height:32px}
}
@media screen and (max-width:600px){
  .tiles{grid-auto-rows:1fr;align-items:stretch;gap:7px}
  .tile{grid-template-rows:minmax(105px,1fr) minmax(78px,auto);min-height:192px;gap:0}
  .tile-label{font-size:12px;gap:5px;min-height:20px}
  .metric-icon{width:17px;height:17px;flex-basis:17px}
  .tile-foot{min-height:0;align-self:stretch;justify-content:space-between;display:flex;flex-direction:column;gap:7px;padding-top:8px}
  .tile-foot .btn{width:100%;min-height:32px}
  .tile-filters .filter-top{display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;gap:6px;padding-bottom:8px}
  .tile-filters .filter-top .btn{width:100%;min-height:32px}
  .tile-filters .tile-chart-foot{display:flex!important;flex-direction:column;align-items:stretch;justify-content:space-between;gap:6px}
  .tile-chart-foot .chart-label{font-size:12px;gap:5px}
  .tile-chart-foot .btn{width:100%;min-height:32px}
}

/* v1.7: dwa spójne, zwarte rzędy na małym ekranie */
.tile-filters .filter-top{display:block;min-width:0;padding-bottom:8px}
.tile-filters .filter-metrics{display:flex;justify-content:space-between;align-items:center;gap:8px;min-width:0}
.tile-filters .filter-metrics .btn{width:auto;min-width:0;flex:0 0 auto;white-space:nowrap}
@container (max-width:600px){
  .wrap{gap:8px}
  .tiles{grid-auto-rows:auto;gap:7px;align-items:stretch}
  .tile{min-height:0;grid-template-rows:68px 53px;padding:8px;gap:0}
  .tile>div:first-child,.tile .filter-top{min-height:0}
  .tile-label{font-size:11px;line-height:1.1;min-height:16px;gap:4px}
  .tile-value{font-size:clamp(17px,5vw,22px);margin-top:2px;line-height:1.15}
  .tile-foot{min-height:0;display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;gap:3px;padding-top:6px;font-size:10px}
  .tile .btn{min-height:29px;padding:4px 6px;font-size:10px}
  .tile-foot .btn{width:100%;min-height:29px}
  .tile-filters .filter-top{display:block;padding-bottom:6px}
  .tile-filters .filter-metrics{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-top:4px}
  .tile-filters .filter-metrics .tile-value{white-space:nowrap;margin:0}
  .tile-filters .filter-metrics .btn{width:auto;min-height:31px;padding:5px 6px;flex:0 0 auto;font-size:9px}
  .tile-filters .tile-chart-foot{display:flex!important;flex-direction:row;align-items:center;justify-content:space-between;gap:4px;padding-top:6px}
  .tile-chart-foot .chart-label{font-size:10px;gap:3px}
  .tile-chart-foot .btn{width:auto;min-width:0;min-height:29px;padding:4px 6px}
}
@media screen and (max-width:600px){
  .wrap{gap:8px}
  .tiles{grid-auto-rows:auto;gap:7px;align-items:stretch}
  .tile{min-height:0;grid-template-rows:68px 53px;padding:8px;gap:0}
  .tile>div:first-child,.tile .filter-top{min-height:0}
  .tile-label{font-size:11px;line-height:1.1;min-height:16px;gap:4px}
  .tile-value{font-size:clamp(17px,5vw,22px);margin-top:2px;line-height:1.15}
  .tile-foot{min-height:0;display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;gap:3px;padding-top:6px;font-size:10px}
  .tile .btn{min-height:29px;padding:4px 6px;font-size:10px}
  .tile-foot .btn{width:100%;min-height:29px}
  .tile-filters .filter-top{display:block;padding-bottom:6px}
  .tile-filters .filter-metrics{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-top:4px}
  .tile-filters .filter-metrics .tile-value{white-space:nowrap;margin:0}
  .tile-filters .filter-metrics .btn{width:auto;min-height:31px;padding:5px 6px;flex:0 0 auto;font-size:9px}
  .tile-filters .tile-chart-foot{display:flex!important;flex-direction:row;align-items:center;justify-content:space-between;gap:4px;padding-top:6px}
  .tile-chart-foot .chart-label{font-size:10px;gap:3px}
  .tile-chart-foot .btn{width:auto;min-width:0;min-height:29px;padding:4px 6px}
}
/* v2.0: animacje są sterowane rzeczywistym przepływem; bez odczytu pozostają zatrzymane. */
.air-svg .flow{animation-duration:var(--flow-duration,2s);transition:opacity .25s}
.air-svg .flow.intake,.air-svg .flow.supply{animation-duration:var(--supply-duration,2s)}
.air-svg .flow.extract,.air-svg .flow.exhaust{animation-duration:var(--extract-duration,2s)}
.visual.no-supply .flow.intake,.visual.no-supply .flow.supply,.visual.no-extract .flow.extract,.visual.no-extract .flow.exhaust{animation-play-state:paused;opacity:.16}
.visual.off .flow{animation-play-state:paused;opacity:.13}
/* Gdy bypass otwarty, nawiew plynie animowanym obejściem wymiennika.
   Dolny tor wywiewu pozostaje bez zmian. Statyczny obrys kanalu nadal widoczny. */
.visual.bypass-open .air-svg .flow.intake,.visual.bypass-open .air-svg .flow.supply{animation-play-state:paused;opacity:.08}
.bypass-indicator,.heater-indicator{transition:opacity .3s ease;pointer-events:none}
.bypass-halo{fill:none;stroke:#4faece;stroke-width:10;opacity:.24;stroke-linecap:round}
@keyframes bypass-travel{to{stroke-dashoffset:-42}}
.bypass-flow{fill:none;stroke:#9fe6ff;stroke-width:4.5;stroke-dasharray:4 17;stroke-linecap:round;animation:bypass-travel var(--supply-duration,2s) linear infinite}
.bypass-pill{fill:#143643cc;stroke:#59c3e4;stroke-width:1.8}
.indicator-text{fill:#d8f7ff;font-weight:700;font-size:12px;font-family:inherit;letter-spacing:.3px}
.heater-halo{fill:#d51f1f2c;stroke:#ff5a5a;stroke-width:3;filter:drop-shadow(0 0 10px #ff5a5a)}
.heater-wave{fill:none;stroke:#ff5a5a;stroke-width:4.5;stroke-linecap:round;filter:drop-shadow(0 0 5px #ff6b6b)}
.visual.no-supply:not(.simulation-active) .bypass-flow,.visual.off:not(.simulation-active) .bypass-flow{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.air-svg .flow,.air-svg .bypass-flow{animation:none!important}}

/* v2.6 — dynamiczne wskazniki, bez powiekszania kafelkow */
.metric-tap{cursor:pointer;border-radius:6px;outline-offset:3px;touch-action:manipulation}
.metric-tap:hover{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:5px}
.metric-tap:focus-visible{outline:2px solid #8ddbd0}
.metric-meter{height:3px;width:100%;background:#2a3940;border-radius:4px;overflow:hidden;margin-top:4px}
.metric-meter span{display:block;width:0;height:100%;border-radius:4px;background:#76d3a2;transition:width .45s ease,background .35s ease}
.metric-meter.no-data{opacity:.2}
.tile-value[data-level=warning],.filter-metrics [data-level=warning]{color:#f2bc6a}
.tile-value[data-level=critical],.filter-metrics [data-level=critical]{color:#ff7979}
.tile-value[data-level=good],.filter-metrics [data-level=good]{color:#8cdeb4}
/* 0.1.4: pasek filtrów jak w pozostałych kafelkach; bez wpływu na reset licznika. */
.tile-filters .filter-meter{margin-top:7px;min-height:3px}
@container (max-width:600px){.tile-filters .filter-meter{margin-top:5px}}
@media screen and (max-width:600px){.tile-filters .filter-meter{margin-top:5px}}
.history-caption{font-size:12px;color:#b5c8d0;margin:4px 0 10px}
.history-chart{width:100%;display:block;border:1px solid #314954;border-radius:12px;background:#0f1c23}
.history-controls{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}
.history-controls .btn{min-width:55px;font-size:13px;padding:7px 9px}
.history-controls .selected{background:#214c42;border-color:#76c6ae}
.history-note{font-size:13px;color:#c5d3db;margin:14px 0}
@media(prefers-reduced-motion:reduce){.metric-meter span{transition:none}}
/* v2.8: mobilny licznik bez obcinania, w osobnym wierszu nad SVG */
.countdown-mobile{display:none}
@container (max-width:600px){
  .visual .air-countdown{position:relative;top:auto;left:auto;right:auto;transform:none;display:table;max-width:100%;width:max-content;margin:0 auto 5px auto;white-space:nowrap;overflow:visible;text-overflow:clip;padding:6px 10px;font-size:clamp(11px,3.3vw,14px);line-height:1.2;box-shadow:0 2px 12px #0004}
  .air-countdown .countdown-desktop{display:none}
  .air-countdown .countdown-mobile{display:inline}
}
@media screen and (max-width:600px){
  .visual .air-countdown{position:relative;top:auto;left:auto;right:auto;transform:none;display:table;max-width:100%;width:max-content;margin:0 auto 5px auto;white-space:nowrap;overflow:visible;text-overflow:clip;padding:6px 10px;font-size:clamp(11px,3.3vw,14px);line-height:1.2;box-shadow:0 2px 12px #0004}
  .air-countdown .countdown-desktop{display:none}
  .air-countdown .countdown-mobile{display:inline}
}

/* 0.1.1: separate chart link and settings button, also in narrow mobile tiles. */
.tile-chart-foot .chart-launch{appearance:none;display:inline-flex;align-items:center;gap:7px;min-width:0;padding:6px 2px;border:0;border-radius:8px;background:transparent;color:#d5e5eb;font:inherit;font-weight:650;cursor:pointer;white-space:nowrap;touch-action:manipulation}
.tile-chart-foot .chart-launch:hover{color:#90d2f2}
.tile-chart-foot .chart-launch:focus-visible,.tile-chart-foot .settings-gear:focus-visible{outline:2px solid #90d2f2;outline-offset:2px}
.tile-chart-foot .chart-launch .metric-icon{width:21px;height:21px;flex:0 0 21px}
.tile-chart-foot .settings-gear{display:inline-flex;align-items:center;justify-content:center;flex:0 0 42px;width:42px!important;min-width:42px!important;height:40px;min-height:40px!important;padding:7px!important;touch-action:manipulation}
.tile-chart-foot .settings-gear svg{display:block;width:24px;height:24px;flex:none;color:#e8f3f7;stroke-width:1.65;filter:none;overflow:visible}
.settings-section{border:1px solid #3a5661;border-radius:12px;padding:13px 14px;margin:12px 0;background:#102029}
 .settings-grid{display:grid;gap:7px;margin-top:12px}.settings-item{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:13px;padding:4px 0;border-bottom:1px solid #29404a}.settings-item span:first-child{color:#b6c8d0}.settings-item strong{text-align:right;max-width:60%;overflow-wrap:anywhere;color:#eff7fb}.settings-muted{font-size:12px;color:#a9bfcc;line-height:1.4}.settings-warn{color:#f2bf70}.settings-section h3{font-size:16px;margin:0 0 8px;color:#eaf6f8}
.settings-section p{font-size:13px;line-height:1.5;margin:6px 0 10px}
.settings-section .btn{width:100%;text-align:center;min-height:43px}
@container (max-width:600px){.tile-filters .tile-chart-foot{display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:5px!important}.tile-chart-foot .chart-launch{font-size:11px;gap:4px;min-height:36px}.tile-chart-foot .chart-launch .metric-icon{width:17px;height:17px;flex-basis:17px}.tile-chart-foot .settings-gear{width:40px!important;min-width:40px!important;flex-basis:40px!important;height:38px;min-height:38px!important}}
@media screen and (max-width:600px){.tile-filters .tile-chart-foot{display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:5px!important}.tile-chart-foot .chart-launch{font-size:11px;gap:4px;min-height:36px}.tile-chart-foot .settings-gear{width:40px!important;min-width:40px!important;flex-basis:40px!important;height:38px;min-height:38px!important}}

/* 0.1.4: potwierdzone sterowanie, pasek filtrów i wyśrodkowany licznik przewietrzania */
.dialog.settings-dialog{width:min(490px,100%);max-height:min(86dvh,780px);padding:20px}
.settings-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:4px 0 16px}
.settings-tabs .settings-tab{min-width:0;min-height:43px;padding:10px 8px;background:#1a2930;border:1px solid #344c56;color:#cadce4;border-radius:10px;font:inherit;font-weight:600;cursor:pointer}
.settings-tabs .settings-tab[aria-selected="true"]{color:#e9f7ff;background:#204052;border-color:#5597b7}
.settings-tabs .settings-tab:focus-visible,.settings-accordion:focus-visible{outline:2px solid #94cdf0;outline-offset:2px}
.settings-dialog .settings-section{margin:0;padding:15px 16px}
.settings-dialog .settings-section h3{margin:0 0 10px}
.settings-dialog .settings-section p{margin:8px 0 14px}
.settings-accordion{display:flex;width:100%;min-height:46px;align-items:center;justify-content:space-between;gap:14px;background:#142b35;border:1px solid #466471;border-radius:10px;color:#e5f2f8;padding:10px 13px;font:inherit;font-weight:600;text-align:left;cursor:pointer}
.settings-accordion:hover{background:#1a3540}
.settings-accordion svg{width:18px;height:18px;flex:0 0 18px;transition:transform .2s}
.settings-accordion[aria-expanded="true"] svg{transform:rotate(180deg)}
.settings-accordion-content{margin-top:8px;padding:4px 4px 0}
.settings-accordion-content .settings-grid{margin:0}
.settings-dialog .settings-item{font-size:13px;line-height:1.45;padding:7px 0;align-items:center}
.settings-dialog .settings-item strong{max-width:48%;font-variant-numeric:tabular-nums}
@container (max-width:480px){.dialog.settings-dialog{padding:16px}.settings-dialog .settings-section{padding:12px}.settings-dialog .settings-item{font-size:12px}}
/* Jednolity licznik MQTT; na telefonie pomiędzy czerpnią i wyrzutnią, bez nowego wiersza. */
.air-countdown-mobile{display:none}
.air-countdown-mobile[hidden]{display:none!important}
@container (max-width:600px){
  .main{position:relative}
  .visual .air-countdown{display:none!important}
  .air-countdown-mobile:not([hidden]){display:flex;position:absolute;z-index:5;top:0;left:50%;transform:translateX(-50%);width:min(108px,32%);max-width:108px;min-height:53px;justify-content:center;align-items:center;flex-direction:column;gap:1px;padding:4px 3px;border:1px solid #72bd9e;border-radius:12px;background:#20483d;color:#e0fff1;font-weight:700;box-shadow:0 3px 10px #0006;text-align:center;pointer-events:none}
  .air-countdown-mobile .airing-short-label{font-size:clamp(8px,2.25vw,10px);line-height:1.15;letter-spacing:-.1px}
  .air-countdown-mobile strong{font-size:clamp(14px,4.2vw,19px);line-height:1.15;font-variant-numeric:tabular-nums}
  .main>.left>.readout:first-child,.main>.right>.readout:first-child{min-height:57px;max-width:calc(100% - 54px)}
  .main>.left>.readout:first-child{justify-self:start}
  .main>.right>.readout:first-child{justify-self:end}
}
@media screen and (max-width:600px){
  .main{position:relative}
  .visual .air-countdown{display:none!important}
  .air-countdown-mobile:not([hidden]){display:flex;position:absolute;z-index:5;top:0;left:50%;transform:translateX(-50%);width:min(108px,32%);max-width:108px;min-height:53px;justify-content:center;align-items:center;flex-direction:column;gap:1px;padding:4px 3px;border:1px solid #72bd9e;border-radius:12px;background:#20483d;color:#e0fff1;font-weight:700;box-shadow:0 3px 10px #0006;text-align:center;pointer-events:none}
  .air-countdown-mobile .airing-short-label{font-size:clamp(8px,2.25vw,10px);line-height:1.15;letter-spacing:-.1px}
  .air-countdown-mobile strong{font-size:clamp(14px,4.2vw,19px);line-height:1.15;font-variant-numeric:tabular-nums}
  .main>.left>.readout:first-child,.main>.right>.readout:first-child{min-height:57px;max-width:calc(100% - 54px)}
  .main>.left>.readout:first-child{justify-self:start}
  .main>.right>.readout:first-child{justify-self:end}
}
</style><ha-card><div class="wrap"><div class="top"><div class="modes"><button class="btn" data-action="auto"><span class="label-full">Automatyczny</span><span class="label-short">Auto</span></button><button class="btn" data-action="manual"><span class="label-full">Ręczny</span><span class="label-short">Ręczny</span></button><button class="btn" data-action="airing"><span class="label-full">Przewietrzanie</span><span class="label-short">Przew.</span></button><button class="btn" data-action="holiday"><span class="label-full">Urlop</span><span class="label-short">Urlop</span></button></div><button class="btn power" data-action="power" aria-label="Włącz lub wyłącz rekuperator"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v10"/><path d="M6.4 5.4a9 9 0 1 0 11.2 0"/></svg></button></div><div class="status info" role="status" aria-live="polite" aria-atomic="true"><span class="dot"></span><span class="status-msg" data-status>Oczekiwanie na dane…</span><button class="status-close" title="Zamknij komunikat" aria-label="Zamknij komunikat" data-action="clear-error" hidden>×</button></div><div class="main"><div class="side left">${this._readout('Czerpnia','sensor.rekuperator_temperatura_czerpnia','#83b6e0')}${this._readout('Wywiew','sensor.rekuperator_temperatura_wywiew','#efaa7d','sensor.rekuperator_predkosc_wywiewu')}</div><div class="visual"><div class="simulation-mark" data-sim-mark hidden>SYMULACJA — BYPASS / GRZAŁKA</div><div class="air-countdown" data-air-countdown hidden></div>${this._svg()}</div><div class="air-countdown-mobile" data-air-countdown-mobile hidden aria-live="off"></div><div class="side right">${this._readout('Wyrzutnia','sensor.rekuperator_temperatura_wyrzutnia','#c297c1')}${this._readout('Nawiew','sensor.rekuperator_temperatura_nawiew','#89d5a0','sensor.rekuperator_predkosc_nawiewu')}</div></div><div class="tiles"><div class="tile"><div><div class="tile-label"><svg class="metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 3.2c-7.4.1-13.3 2.1-16.1 7-2.1 3.7-1.2 7.7 1.8 9.2 3.2 1.7 7.6.3 10-3 2.1-2.9 3.5-7.3 4.3-13.2Z"/><path d="M4 21c2.7-4.1 6.5-7.1 12-10"/></svg> CO₂</div><div class="tile-value metric-tap" data-action="history" data-entity="sensor.rekuperator_co2" data-value="sensor.rekuperator_co2" role="button" tabindex="0" title="Pokaż historię CO₂"></div><div class="metric-meter" data-meter="co2"><span></span></div></div><div class="tile-foot"><span>Bypass: <strong data-bypass>—</strong></span><button class="btn" data-action="bypass">Zmień</button></div></div><div class="tile"><div><div class="tile-label"><svg class="metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m13 2-8 11h6l-1 9 9-12h-6l1-8Z"/></svg> Moc wentylatorów</div><div class="tile-value metric-tap" data-action="history" data-entity="sensor.rekuperator_sumaryczny_pobor_mocy" data-value="sensor.rekuperator_sumaryczny_pobor_mocy" role="button" tabindex="0" title="Pokaż historię mocy wentylatorów"></div><div class="metric-meter" data-meter="power"><span></span></div></div><div class="tile-foot"><span>Sprawność: <strong data-value="sensor.rekuperator_sprawnosc">—</strong></span></div></div><div class="tile"><div><div class="tile-label"><svg class="metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2C9 7.1 5 11.2 5 15.5a7 7 0 0 0 14 0C19 11.2 15 7.1 12 2Z"/><path d="M9 17a3.3 3.3 0 0 0 3 2"/></svg> Wilgotność</div><div class="tile-value metric-tap" data-action="history" data-entity="sensor.rekuperator_wilgotnosc" data-value="sensor.rekuperator_wilgotnosc" role="button" tabindex="0" title="Pokaż historię wilgotności"></div><div class="metric-meter" data-meter="humidity"><span></span></div></div><div class="tile-foot"><span>Komfort: <strong data-value="sensor.rekuperator_temperatura_komfortu">—</strong></span><button class="btn" data-action="comfort">Ustaw</button></div></div><div class="tile tile-filters"><div class="filter-top"><div><div class="tile-label"><svg class="metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v4l-6.5 6.5V20l-3 1v-6.5L4 8V4Z"/><path d="M8 8h8"/></svg> Filtry</div><div class="filter-metrics"><div class="tile-value"><span data-value="sensor.rekuperator_dni_do_wymiany_filtrow" data-filter-days>—</span> dni</div><button class="btn" data-action="filters">Reset filtrów</button></div><div class="metric-meter filter-meter no-data" data-meter="filters" role="progressbar" aria-label="Pozostałe dni do wymiany filtrów" aria-valuemin="0" aria-valuemax="90" aria-valuetext="Brak danych"><span></span></div></div></div><div class="tile-foot tile-chart-foot"><button type="button" class="chart-label chart-launch" data-action="charts" aria-label="Otwórz wykresy" title="Otwórz wykresy"><svg class="metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M6 16l5-5 4 3 5-7"/><path d="M16 7h4v4"/></svg> Wykresy</button><button type="button" class="btn settings-gear" data-action="settings" title="Ustawienia karty i rekuperatora" aria-label="Ustawienia karty i rekuperatora"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.24,4.33 L9.89,4.13 L9.97,2.00 L14.03,2.00 L14.11,4.13 L14.76,4.33 L15.47,4.63 L16.08,4.94 L17.63,3.49 L20.51,6.37 L19.06,7.93 L19.37,8.53 L19.67,9.24 L19.87,9.89 L22.00,9.97 L22.00,14.03 L19.87,14.11 L19.67,14.76 L19.37,15.47 L19.06,16.07 L20.51,17.63 L17.63,20.51 L16.08,19.06 L15.47,19.37 L14.76,19.67 L14.11,19.87 L14.03,22.00 L9.97,22.00 L9.89,19.87 L9.24,19.67 L8.53,19.37 L7.93,19.06 L6.37,20.51 L3.49,17.63 L4.94,16.07 L4.63,15.47 L4.33,14.76 L4.13,14.11 L2.00,14.03 L2.00,9.97 L4.13,9.89 L4.33,9.24 L4.63,8.53 L4.94,7.92 L3.49,6.37 L6.37,3.49 L7.92,4.94 L8.53,4.63Z"/><circle cx="12" cy="12" r="3.35"/></svg></button></div></div></div></div><div id="modal-root"></div></ha-card>`;
    this._update();}
  _diagnosticState(id) {
    // Oddzielna encja opcjonalna: bez niej nie twierdzimy, że znamy błędy producenta.
    if (!id || !this._valid(id)) return null;
    const state=String(this._state(id)).trim();
    if (!state || /^(0|ok|none|no errors|brak|brak błędów|false|off|normal|nie|-|—)$/i.test(state) || /^🟢?\s*System działa prawidłowo$/i.test(state) || /^System jest wyłączony$/i.test(state) || /^Urządzenie (?:włączone|wyłączone)$/i.test(state)) return null;
    return state;
  }
  _updateAirVisual() {
    const visual=this.shadowRoot.querySelector('.visual');
    if(!visual)return;
    const on=this._isOn();
    const supply=this._valid('sensor.rekuperator_predkosc_nawiewu')?Number(this._state('sensor.rekuperator_predkosc_nawiewu')):NaN;
    const extract=this._valid('sensor.rekuperator_predkosc_wywiewu')?Number(this._state('sensor.rekuperator_predkosc_wywiewu')):NaN;
    const maxFlow=Math.max(1,Number(this._config.flow_max_m3h)||370);
    const minSeconds=Math.max(.3,Number(this._config.animation_min_seconds)||.8);
    const maxSeconds=Math.max(minSeconds,Number(this._config.animation_max_seconds)||4.2);
    const duration=(rate)=>{
      const ratio=Math.max(0,Math.min(1,rate/maxFlow));
      return (maxSeconds-(maxSeconds-minSeconds)*ratio).toFixed(2)+'s';
    };
    const supplyActive=on&&Number.isFinite(supply)&&supply>0;
    const extractActive=on&&Number.isFinite(extract)&&extract>0;
    visual.classList.toggle('no-supply',!supplyActive);
    visual.classList.toggle('no-extract',!extractActive);
    const sd=duration(supplyActive?supply:0),ed=duration(extractActive?extract:0);
    if(visual.style.getPropertyValue('--supply-duration')!==sd)visual.style.setProperty('--supply-duration',sd);
    if(visual.style.getPropertyValue('--extract-duration')!==ed)visual.style.setProperty('--extract-duration',ed);
    const bypassState=String(this._state('sensor.rekuperator_stan_bypassu')||'');
    const bypassOpen=this._simulation.enabled ? this._simulation.bypass : (on&&/^Otwarty/.test(bypassState));
    const heaterOn=this._simulation.enabled ? this._simulation.heater : (on&&this._state('binary_sensor.rekuperator_grzalka_wstepna')==='on');
    const bypass=visual.querySelector('[data-bypass-indicator]');
    const heater=visual.querySelector('[data-heater-indicator]');
    visual.classList.toggle('bypass-open',bypassOpen);
    if(bypass)bypass.setAttribute('opacity',bypassOpen?'1':'0');
    if(heater)heater.setAttribute('opacity',heaterOn?'1':'0');
    visual.classList.toggle('simulation-active',this._simulation.enabled);
    const watermark=visual.querySelector('[data-sim-mark]'); if(watermark)watermark.hidden=!this._simulation.enabled;
    visual.setAttribute('aria-label',`Nawiew: ${supplyActive?supply+' m³/h':'brak ruchu lub danych'}, wywiew: ${extractActive?extract+' m³/h':'brak ruchu lub danych'}, bypass: ${bypassState||'brak danych'}, grzałka: ${heaterOn?'włączona':'wyłączona lub brak danych'}`);
  }
  _statusInfo() {
    const mode=this._mode();
    const base=`${this._isOn()?'Urządzenie włączone':'Urządzenie wyłączone'} · ${mode}`;
    // Najwyższy priorytet: jawnie skonfigurowana encja błędów albo błąd usługi HA.
    const diagnostic=this._diagnosticState(this._config.error_entity);
    if(diagnostic) return {level:'error',text:`Alarm rekuperatora: ${diagnostic}`,clear:false};
    if(this._lastError) return {level:'error',text:`Błąd sterowania: ${this._lastError}`,clear:true};
    if(this._commOffline()){
      const last=this._diagnostics()?.attributes?.reqnet_last_mqtt_response;
      return {level:'warn',text:`Brak aktualnej odpowiedzi MQTT z rekuperatora · Ostatni odczyt: ${this._formatTime(last)}. Sterowanie jest wstrzymane.`,clear:false};
    }
    // Komunikaty producenta można dodać po utworzeniu osobnego sensora MQTT.
    const message=this._diagnosticState(this._config.message_entity);
    if(message){
      const level=/(alarm|awaria|błąd|error|fault|failure)/i.test(message)?'error':/(ostrzeż|warning|uwaga|filtr|filter|brak odczytu)/i.test(message)?'warn':'info';
      return {level,text:message,clear:false};
    }
    if(this._config.error_entity && !this._valid(this._config.error_entity)) return {level:'warn',text:'Brak odczytu sensora alarmów — sprawdź konfigurację diagnostyki',clear:false};
    const essential=['sensor.rekuperator_temperatura_czerpnia','sensor.rekuperator_temperatura_nawiew','sensor.rekuperator_aktualny_tryb'];
    if (essential.some(id=>!this._valid(id))) return {level:'warn',text:'Brak części odczytów z rekuperatora — sprawdź MQTT',clear:false};
    const days=Number(this._state('sensor.rekuperator_dni_do_wymiany_filtrow'));
    const threshold=Number(this._config.filter_warning_days ?? 7);
    if(this._valid('sensor.rekuperator_dni_do_wymiany_filtrow') && Number.isFinite(days) && Number.isFinite(threshold) && days<=threshold){
      return {level:'warn',text:days<=0?'Filtry: termin wymiany minął':`Filtry: do wymiany pozostało ${days} dni`,clear:false};
    }
    if (this._state('binary_sensor.rekuperator_grzalka_wstepna')==='on') {
      return {level:'info',text:`${base} · Grzałka aktywna`,clear:false};
    }
    const bypass=this._state('sensor.rekuperator_stan_bypassu')||'';
    if (String(bypass).includes('Ręcznie')) return {level:'info',text:`${base} · Bypass w trybie ręcznym`,clear:false};
    return {level:'info',text:base,clear:false};
  }
  _update(){
    if(!this._rendered)return;
    for(const el of this.shadowRoot.querySelectorAll('[data-value]')){
      const id=el.dataset.value;
      // data-value is also used by modal choice/preset buttons; never overwrite button labels.
      if(!id || !/^(sensor|number|input_number)\./.test(id))continue;
      const unit=({sensor_rekuperator_co2:'ppm',sensor_rekuperator_sumaryczny_pobor_mocy:'W',sensor_rekuperator_sprawnosc:'%',sensor_rekuperator_wilgotnosc:'%',sensor_rekuperator_temperatura_komfortu:'°C',sensor_rekuperator_predkosc_nawiewu:'m³/h',sensor_rekuperator_predkosc_wywiewu:'m³/h'})[id.replaceAll('.','_')]||'';
      const temp=id.includes('temperatura_')&&!id.includes('komfortu');
      el.textContent=this._fmt(id,unit||(temp?'°C':''),temp?1:0);
    }
    const mode=this._mode();
    const active={'Tryb inteligentny':'auto','Tryb ręczny':'manual','Przewietrzanie':'airing','Urlop':'holiday'}[mode];
    for(const el of this.shadowRoot.querySelectorAll('.modes .btn')){
      el.classList.toggle('active',el.dataset.action===active);
      el.setAttribute('aria-pressed',String(el.dataset.action===active));
    }
    const on=this._isOn();
    this.shadowRoot.querySelector('.power').classList.toggle('on',on);
    const offline=this._commOffline();
    for(const btn of this.shadowRoot.querySelectorAll('.modes .btn, .power, .tile-foot [data-action="bypass"], .tile-foot [data-action="comfort"], .tile-filters [data-action="filters"]')){
      btn.disabled=offline;
      btn.title=offline?'Brak aktualnego połączenia MQTT — sterowanie niedostępne':'';
    }
    this.shadowRoot.querySelector('.visual').classList.toggle('off',!on);
    this._updateAirVisual();
    const status=this._simulation.enabled && !this._commOffline() ? {level:'warn',text:'SYMULACJA WYGLĄDU — wartości i sterowanie urządzenia pozostają rzeczywiste',clear:false} : this._statusInfo();
    const statusEl=this.shadowRoot.querySelector('.status');
    statusEl.className=`status ${status.level}`;
    statusEl.querySelector('.dot').classList.toggle('on',status.level==='info'&&on);
    statusEl.querySelector('[data-status]').textContent=status.text;
    statusEl.querySelector('.status-close').hidden=!status.clear;
    this.shadowRoot.querySelector('[data-bypass]').textContent=this._value('sensor.rekuperator_stan_bypassu');
    this._updateIndicators();
    this._updateCountdown();
    if(this._modal==='settings')this._updateSettingsDiagnostics();
  }
  _updateIndicators(){
    const read=(id)=>this._valid(id)?Number(this._state(id)):NaN;
    const set=(key,id,max,color,level)=>{
      const meter=this.shadowRoot.querySelector(`[data-meter="${key}"]`);
      const value=this.shadowRoot.querySelector(`.tile-value[data-value="${id}"]`);
      const n=read(id),valid=Number.isFinite(n);
      if(meter){meter.classList.toggle('no-data',!valid);meter.querySelector('span').style.width=(valid?Math.min(100,Math.max(0,n/Math.max(1,max)*100)):0)+'%';meter.querySelector('span').style.background=color;}
      if(value){value.dataset.level=valid?level:'unknown';value.title=valid?`${n.toLocaleString('pl-PL')} — dotknij, aby zobaczyć historię`:'Brak danych — dotknij, aby zobaczyć historię';}
    };
    const co2=read('sensor.rekuperator_co2');
    const good=Number(this._config.co2_good_max)||800,warn=Number(this._config.co2_warning_max)||1200;
    const co2level=co2<good?'good':co2<warn?'warning':'critical';
    set('co2','sensor.rekuperator_co2',Math.max(1600,warn*1.3),co2level==='good'?'#6dd69d':co2level==='warning'?'#f2bb63':'#f37b7b',co2level);
    const power=read('sensor.rekuperator_sumaryczny_pobor_mocy');
    const pref=Math.max(1,Number(this._config.power_reference_w)||200);
    // Kolor mocy jest progiem wizualnym, nie diagnozą awarii centrali.
    const powerGood=Number(this._config.power_good_max??40);
    const powerWarning=Number(this._config.power_warning_max??100);
    const powerLevel=power<powerGood?'good':power<=powerWarning?'warning':'critical';
    const powerColor=powerLevel==='good'?'#6dd69d':powerLevel==='warning'?'#f4ba67':'#f37b7b';
    set('power','sensor.rekuperator_sumaryczny_pobor_mocy',pref,powerColor,powerLevel);
    const humidity=read('sensor.rekuperator_wilgotnosc');
    const low=Number(this._config.humidity_low??40),high=Number(this._config.humidity_high??60);
    const humlevel=humidity<low||humidity>high?'warning':'good';
    set('humidity','sensor.rekuperator_wilgotnosc',100,humlevel==='good'?'#72c7e9':'#eab66b',humlevel);
    const days=read('sensor.rekuperator_dni_do_wymiany_filtrow');
    const filter=this.shadowRoot.querySelector('[data-filter-days]');
    const dv=this.shadowRoot.querySelector('.tile-filters .tile-value');
    const fl=days<=0?'critical':days<=Number(this._config.filter_warning_days??7)?'warning':'good';
    if(filter){filter.dataset.level=Number.isFinite(days)?fl:'unknown';filter.title=Number.isFinite(days)?(days<=0?'Termin wymiany filtrów minął':`Do wymiany filtrów: ${days} dni`):'Brak odczytu filtra';}
    if(dv)dv.dataset.level=Number.isFinite(days)?fl:'unknown';
    // Proporcja pozostałych dni w cyklu. Domyślnie 90 dni; konfigurowalne w YAML.
    // Nie wnioskujemy o długości cyklu na podstawie pojedynczego odczytu urządzenia.
    const filterMeter=this.shadowRoot.querySelector('[data-meter="filters"]');
    const configuredCycle=Number(this._config.filter_cycle_days);
    const filterCycle=Number.isFinite(configuredCycle)&&configuredCycle>0?configuredCycle:90;
    const filterKnown=Number.isFinite(days);
    const remainingRatio=filterKnown?Math.min(100,Math.max(0,days/filterCycle*100)):0;
    if(filterMeter){
      filterMeter.classList.toggle('no-data',!filterKnown);
      filterMeter.querySelector('span').style.width=`${remainingRatio}%`;
      filterMeter.querySelector('span').style.background=fl==='critical'?'#ff7979':fl==='warning'?'#f2bc6a':'#6dd69d';
      filterMeter.setAttribute('aria-valuemax',String(filterCycle));
      if(filterKnown){
        filterMeter.setAttribute('aria-valuenow',String(Math.min(filterCycle,Math.max(0,days))));
        filterMeter.setAttribute('aria-valuetext',`${days} dni do wymiany filtrów (cykl ${filterCycle} dni)`);
      }else{
        filterMeter.removeAttribute('aria-valuenow');
        filterMeter.setAttribute('aria-valuetext','Brak aktualnych danych');
      }
      filterMeter.title=filterKnown?`${days} z ${filterCycle} dni do wymiany filtrów`:'Brak aktualnych danych o filtrach';
    }
  }
  async _showHistory(entity,hours=6){
    const known={
      'sensor.rekuperator_co2':['CO₂','ppm','#87d8b3'],
      'sensor.rekuperator_sumaryczny_pobor_mocy':['Moc wentylatorów','W','#e7b66b'],
      'sensor.rekuperator_wilgotnosc':['Wilgotność','%','#77c5ee'],
      'sensor.rekuperator_temperatura_czerpnia':['Czerpnia','°C','#83b6e0'],
      'sensor.rekuperator_temperatura_wywiew':['Wywiew','°C','#efaa7d'],
      'sensor.rekuperator_temperatura_wyrzutnia':['Wyrzutnia','°C','#c297c1'],
      'sensor.rekuperator_temperatura_nawiew':['Nawiew','°C','#89d5a0']
    };
    if(!known[entity])return;
    const [label,unit,color]=known[entity];
    const request=++this._historyRequest;
    this._historyEntity=entity;
    this._historyHours=hours;
    const choices=[3,6,12,24].map(h=>`<button class="btn ${hours===h?'selected':''}" data-action="history-range" data-hours="${h}">${h} h</button>`).join('');
    this._show(`Historia: ${label}`,`<div class="history-caption">Ostatnie ${hours} godzin · ${this._esc(unit)} · dotknij zakresu, aby zmienić okres</div><div class="history-controls">${choices}</div><div data-history-output class="history-note">Pobieranie historii z Home Assistant…</div>`,'Zamknij','close');
    const output=this.shadowRoot.querySelector('[data-history-output]');
    try{
      if(typeof this._hass?.callApi!=='function')throw new Error('Brak dostępu do historii Home Assistant');
      const start=new Date(Date.now()-hours*3600000).toISOString();
      const actual=this._actualEntity(entity);
      if(!actual){output.textContent='Nie znaleziono encji historii. Sprawdź konfigurację urządzenia.';return;}
      const query=`history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(actual)}&minimal_response&no_attributes`;
      const response=await this._hass.callApi('GET',query);
      if(request!==this._historyRequest||!output?.isConnected||this._historyEntity!==entity)return;
      const raw=Array.isArray(response?.[0])?response[0]:[];
      const points=raw.map(r=>({time:Date.parse(r.last_changed||r.last_updated),value:Number(r.state)})).filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.value)).sort((a,b)=>a.time-b.time);
      if(!points.length){output.textContent='Brak zapisanej historii dla tego sensora w wybranym okresie. Sprawdź, czy encja jest zapisywana przez Recorder.';return;}
      const end=Date.now(),begin=end-hours*3600000;
      // Uśrednianie do przedziałów czasowych; każda próbka to nadal rzeczywisty odczyt HA.
      // Odrzucamy pojedyncze błędne zera dla czujników, które nie powinny wskazywać 0
      // (nie filtrujemy zer w poborze mocy, bo wyłączenie wentylatorów jest prawidłowe).
      const isCo2=entity==='sensor.rekuperator_co2';
      const isHum=entity==='sensor.rekuperator_wilgotnosc';
      const valid=points.filter(p=>p.time>=begin&&p.time<=end&&(!isCo2||p.value>=250)&&(!isHum||(p.value>=1&&p.value<=100)));
      if(!valid.length){output.textContent='Brak wiarygodnych próbek do pokazania w wybranym zakresie.';return;}
      const bucketMinutes=hours<=3?2:hours<=6?4:hours<=12?8:15;
      const interval=bucketMinutes*60000;
      const groups=new Map();
      for(const point of valid){
        const index=Math.floor((point.time-begin)/interval);
        const arr=groups.get(index)||[];arr.push(point.value);groups.set(index,arr);
      }
      const averaged=[...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([idx,values])=>({
        time:begin+(idx+0.5)*interval,
        value:values.reduce((sum,v)=>sum+v,0)/values.length
      }));
      const min=Math.min(...averaged.map(p=>p.value)),max=Math.max(...averaged.map(p=>p.value));
      const pad=(max-min||Math.max(1,Math.abs(max)*.05))*.14;
      const lo=min-pad,hi=max+pad;
      const x=p=>36+((p.time-begin)/(end-begin))*344;
      const y=p=>152-((p.value-lo)/(hi-lo))*124;
      const path=averaged.map((p,i)=>`${i?'L':'M'}${Math.min(380,Math.max(36,x(p))).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
      const format=v=>Number(v).toLocaleString('pl-PL',{maximumFractionDigits:1});
      output.innerHTML=`<svg class="history-chart" viewBox="0 0 400 186" role="img" aria-label="Uśredniony wykres ${this._esc(label)} z ostatnich ${hours} godzin"><path d="M36 28H380 M36 90H380 M36 152H380" stroke="#314450" stroke-width="1"/><text x="6" y="32" font-size="11" fill="#b6c7d0">${format(hi)}</text><text x="6" y="153" font-size="11" fill="#b6c7d0">${format(lo)}</text><path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><text x="36" y="174" font-size="11" fill="#b6c7d0">${new Date(begin).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</text><text x="380" y="174" text-anchor="end" font-size="11" fill="#b6c7d0">Teraz</text></svg><div class="history-caption">Zakres średnich: ${format(min)}–${format(max)} ${this._esc(unit)} · Interwał: ${bucketMinutes} min · Próbek: ${valid.length} · Punktów: ${averaged.length}</div>`;
    }catch(e){if(request===this._historyRequest&&output?.isConnected)output.textContent='Nie udało się pobrać historii. Sprawdź dostęp do Recorder i uprawnienia użytkownika.';}
  }
  _updateCountdown(){
    const outputs=[this.shadowRoot.querySelector('[data-air-countdown]'),
                   this.shadowRoot.querySelector('[data-air-countdown-mobile]')].filter(Boolean);
    if(!outputs.length)return;
    const hide=()=>{for(const el of outputs){el.hidden=true;el.textContent='';}};
    if(this._mode()!=='Przewietrzanie' || !this._isOn() || this._commOffline()){
      hide();return;
    }
    const entityId=this._reqSelection?.byKey?.przewietrzanie_pozostalo_sekund;
    const entity=entityId && this._hass?.states?.[entityId];
    const remainingAtSample=Number(entity?.state);
    const timestamp=Date.parse(entity?.attributes?.reqnet_sample_utc || '');
    if(!entity || !Number.isFinite(remainingAtSample) || remainingAtSample<0 ||
       !Number.isFinite(timestamp)){
      hide();return;
    }
    // Interpolate only from the last device-reported minutes/seconds.
    // If the last response is stale, do not invent a remaining duration.
    const elapsed=(Date.now()-timestamp)/1000;
    if(elapsed < -10 || elapsed > 150){hide();return;}
    const remaining=Math.max(0,Math.ceil(remainingAtSample-Math.max(0,elapsed)));
    if(!remaining){hide();return;}
    const mm=String(Math.floor(remaining/60)).padStart(2,'0');
    const ss=String(remaining%60).padStart(2,'0');
    const full=`Przewietrzanie · pozostało ok. ${mm}:${ss}`;
    const pc=outputs[0],mobile=outputs[1];
    if(pc){pc.textContent=full;pc.hidden=false;}
    if(mobile){mobile.innerHTML=`<span class="airing-short-label">Przewietrzanie</span><strong>${mm}:${ss}</strong>`;
      mobile.setAttribute('aria-label', full);mobile.hidden=false;}
  }
  async _call(domain,service,data={}){
    if(this._busy)return;
    if(!this._reqSelection?.ready || !this._resolvedEntryId){this._error('Nie znaleziono urządzenia integracji reQ. Sprawdź entry_id.');return;}
    if(this._commOffline()){this._error('Brak odpowiedzi MQTT — polecenie nie zostało wysłane.');return;}
    if(data.entity_id){data={...data,entity_id:this._actualEntity(data.entity_id)};
      if(!data.entity_id){this._error('Nie znaleziono encji sterującej');return;}}
    this._busy=true;
    const confirmButton=this.shadowRoot.querySelector('.dialog .btn.primary');
    if(confirmButton){confirmButton.disabled=true;confirmButton.dataset.originalLabel=confirmButton.textContent;confirmButton.textContent='Oczekiwanie na centralę…';}
    try{
      await this._hass.callService(domain,service,data);
      // The countdown follows device telemetry, never an optimistic local timer.
      // After service publish, the next CurrentWorkParametersResult provides its value.
      this._lastError=null;this._close();this._update();
    }catch(e){this._error(e?.message||String(e));}
    finally{
      this._busy=false;
      if(confirmButton?.isConnected){confirmButton.disabled=false;confirmButton.textContent=confirmButton.dataset.originalLabel||'Zatwierdź';}
    }
  }
  _error(msg){this._lastError=String(msg);const el=this.shadowRoot.querySelector('.dialog .error');if(el)el.textContent=msg;else console.error('Rekuperator:',msg);this._update();}
  _close(){this._historyRequest++;this._historyEntity=null;this._modal=null;this._draft={};this.shadowRoot.querySelector('#modal-root').innerHTML='';}
  _show(title,body,confirmLabel='Zatwierdź',confirmAction='confirm'){this._modal=confirmAction;this.shadowRoot.querySelector('#modal-root').innerHTML=`<div class="overlay"><section class="dialog" role="dialog" aria-modal="true" aria-label="${this._esc(title)}"><h2>${this._esc(title)}</h2>${body}<div class="error" role="alert"></div><div class="dialog-actions"><button class="btn" data-action="close">Anuluj</button><button class="btn primary" data-action="${confirmAction}">${this._esc(confirmLabel)}</button></div></section></div>`;}
  _checkNumber(key,min,max,step=1){const n=Number(this._draft[key]);if(!Number.isFinite(n)||this._draft[key]===''||n<min||n>max||Math.abs((n-min)/step-Math.round((n-min)/step))>1e-6){this._error(`Nieprawidłowa wartość: ${key}. Dozwolone ${min}–${max}, krok ${step}.`);return null;}return n;}
  _settingsDiagnosticsHtml(){
    const diagnostic=this._diagnostics();
    if(!diagnostic)return '<p class="settings-warn">Oczekiwanie na dane diagnostyczne integracji.</p>';
    const attr=diagnostic.attributes||{};
    const api=attr.reqnet_api_info||{};
    const cell=(label,value)=>`<div class="settings-item"><span>${this._esc(label)}</span><strong>${this._esc(value ?? '—')}</strong></div>`;
    const signal=api.WIFISignalStrength;
    const signalText=signal!==null&&signal!==undefined&&signal!==''?`${signal} / 6`:'—';
    // DeviceType is a numeric protocol identifier, NOT a verified commercial model.
    // Never present cached HTTP metadata as a current read after an API error.
    const rawDeviceType=api.DeviceType;
    const validDeviceType=typeof rawDeviceType==='number'
      ? Number.isSafeInteger(rawDeviceType)&&rawDeviceType>=0
      : typeof rawDeviceType==='string'&&/^\d{1,10}$/.test(rawDeviceType.trim());
    const deviceType=attr.reqnet_api_last_success&&!attr.reqnet_api_error&&validDeviceType
      ? String(rawDeviceType).trim():'Brak danych';
    const body=[
      cell('Typ urządzenia (DeviceType)',deviceType),
      cell('Połączenie MQTT',diagnostic.state==='Połączono'?'Połączono':'Brak odpowiedzi'),
      cell('Ostatnia odpowiedź MQTT',this._formatTime(attr.reqnet_last_mqtt_response)),
      cell('Adres IP',attr.reqnet_api_host||api.WIFIIP||'—'),
      cell('Adres MAC',attr.reqnet_mac||'—'),
      cell('Firmware centrali',api.RecuperatorSoftwareVersion),
      cell('Wersja API modułu Wi-Fi',api.APIVersion),
      cell('Sygnał Wi-Fi',signalText),
    ];
    return `<div class="settings-grid">${body.join('')}</div>`;
  }
  _updateSettingsDiagnostics(){
    const el=this.shadowRoot.querySelector('[data-settings-diagnostics]');
    if(el)el.innerHTML=this._settingsDiagnosticsHtml();
  }
  _showSettings(){
    this._modal='settings';
    const tab=this._settingsTab==='rekuperator'?'rekuperator':'karta';
    const label=this._simulation.enabled?'Zakończ test wizualizacji':'Test wizualizacji';
    const section=tab==='karta'
      ? `<section class="settings-section" id="settings-karta" role="tabpanel" aria-labelledby="settings-tab-karta"><h3>Karta</h3><p>Wersja karty: <strong>0.1.12</strong></p><p>Sprawdź wygląd bypassu i grzałki bez zmiany parametrów urządzenia.</p><button type="button" class="btn" data-action="simulation">${this._esc(label)}</button></section>`
      : `<section class="settings-section" id="settings-rekuperator" role="tabpanel" aria-labelledby="settings-tab-rekuperator"><button type="button" class="settings-accordion" data-action="settings-info-toggle" aria-expanded="${this._deviceInfoExpanded?'true':'false'}" aria-controls="settings-info"><span>Informacje o urządzeniu</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div id="settings-info" class="settings-accordion-content" ${this._deviceInfoExpanded?'':'hidden'}><div data-settings-diagnostics></div></div></section>`;
    this.shadowRoot.querySelector('#modal-root').innerHTML=`<div class="overlay"><section class="dialog settings-dialog" role="dialog" aria-modal="true" aria-label="Ustawienia karty i rekuperatora"><h2>Ustawienia</h2><div class="settings-tabs" role="tablist" aria-label="Ustawienia"><button type="button" class="settings-tab" id="settings-tab-karta" role="tab" aria-selected="${tab==='karta'}" aria-controls="settings-karta" data-action="settings-tab" data-settings-tab="karta">Karta</button><button type="button" class="settings-tab" id="settings-tab-rekuperator" role="tab" aria-selected="${tab==='rekuperator'}" aria-controls="settings-rekuperator" data-action="settings-tab" data-settings-tab="rekuperator">Rekuperator</button></div>${section}<div class="dialog-actions"><button type="button" class="btn primary" data-action="close">Zamknij</button></div></section></div>`;
    this._updateSettingsDiagnostics();
  }
  _showSimulation(){
    const button=(key,value,label)=>`<button type="button" data-action="sim-set" data-sim-key="${key}" data-sim-value="${value}" class="${String(this._simulation[key])===value?'selected':''}" aria-pressed="${String(this._simulation[key])===value}">${label}</button>`;
    this._show('Test wizualizacji',`<p class="simulation-note">TYLKO PODGLĄD — nie wysyła żadnych poleceń do rekuperatora. Odczyty pozostają prawdziwe.</p><div class="field"><label>Bypass (podgląd)</label><div class="simulation-choice">${button('bypass','false','Zamknięty')}${button('bypass','true','Otwarty')}</div></div><div class="field"><label>Grzałka (podgląd)</label><div class="simulation-choice">${button('heater','false','Wyłączona')}${button('heater','true','Włączona')}</div></div>`,'Zamknij podgląd','close');
  }
  _act(action,button){
    if(action==='settings'){this._showSettings();return;}
    if(action==='settings-tab'){
      const tab=button?.dataset?.settingsTab;
      if(tab!=='karta'&&tab!=='rekuperator')return;
      this._settingsTab=tab;this._showSettings();return;
    }
    if(action==='settings-info-toggle'){
      if(this._settingsTab!=='rekuperator')return;
      this._deviceInfoExpanded=!this._deviceInfoExpanded;
      this._showSettings();return;
    }
    if(action==='history'){this._showHistory(button?.dataset?.entity,6);return;}
    if(action==='history-range'){if(this._historyEntity){this._showHistory(this._historyEntity,Number(button?.dataset?.hours)||6);}return;}
    if(action==='simulation'){
      if(this._simulation.enabled){this._simulation={enabled:false,bypass:false,heater:false};this._close();this._update();}
      else{this._simulation={enabled:true,bypass:false,heater:false};this._update();this._showSimulation();}
      return;
    }
    if(action==='sim-set'){
      const key=button?.dataset?.simKey;
      if(!['bypass','heater'].includes(key))return;
      this._simulation[key]=button.dataset.simValue==='true';
      this._update();this._showSimulation();return;
    }
    if(action==='adjust'){
      const key=button?.dataset?.key;
      const wrap=[...this.shadowRoot.querySelectorAll('[data-control]')].find(w=>w.dataset.control===key);
      const range=wrap?.querySelector('input[type="range"]');
      if(!range)return;
      const increment=Number(button.dataset.delta)*Number(range.step);
      this._draft[key]=String(this._snap(Number(this._draft[key])+increment,Number(range.min),Number(range.max),Number(range.step)));
      this._syncControl(key);return;
    }
    if(action==='match-flow'){this._draft.extract=String(this._draft.supply);this._syncControl('extract');return;}
    if(action==='preset-time'){
      const n=Number(button?.dataset?.value);
      const wrap=[...this.shadowRoot.querySelectorAll('[data-control]')].find(w=>w.dataset.control==='minutes');
      const r=wrap?.querySelector('input[type="range"]');
      if(!r||!Number.isFinite(n))return;
      this._draft.minutes=String(this._snap(n,Number(r.min),Number(r.max),Number(r.step)));
      this._syncControl('minutes');return;
    }
    if(action==='choose-bypass'){
      const mode=button?.dataset?.value;
      if(!['0','1','2'].includes(mode))return;
      this._draft.bypass=mode;
      for(const b of this.shadowRoot.querySelectorAll('.choice-btn')){
        const active=b.dataset.value===mode;
        b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));
      }
      return;
    }
    if(action==='clear-error'){this._lastError=null;this._update();return;}if(action==='close'){this._close();return;}if(action==='charts'){
      // Nawigacja w obrębie dashboardu; docelową ścieżkę określa chart_path.
      // Wykresy to subview tego samego dashboardu — aplikacja Android nie otwiera zewnętrznej przeglądarki.
      reqNavigateToSibling('wykresy', this._config.chart_path);
      return;
    }
    const commandActions=new Set(['power','auto','holiday','manual','airing','comfort','bypass','filters',
      'power-confirm','auto-confirm','holiday-confirm','manual-confirm','airing-confirm','comfort-confirm','bypass-confirm','filters-confirm']);
    if(commandActions.has(action)&&this._commOffline()){
      this._error('Brak aktualnych danych MQTT — sterowanie nie jest dostępne.');return;
    }
    if(action==='power'){this._show(this._isOn()?'Wyłączyć rekuperator?' :'Włączyć rekuperator?','<p>Potwierdź zmianę zasilania urządzenia.</p>','Potwierdź','power-confirm');return;}
    if(action==='auto'){this._show('Tryb automatyczny','<p>Uruchomić tryb inteligentny rekuperatora?</p>','Uruchom','auto-confirm');return;}
    if(action==='holiday'){this._show('Tryb urlopowy','<p>Włączyć tryb urlopowy?</p>','Włącz','holiday-confirm');return;}
    if(action==='manual'){const supply=Number(this._value('number.rekuperator_zadany_nawiew_reczny',150));const extract=Number(this._value('number.rekuperator_zadany_wyciag_reczny',150));this._draft={supply:String(Number.isFinite(supply)?supply:150),extract:String(Number.isFinite(extract)?extract:150)};this._show('Tryb ręczny',`<p>Nastawy zostaną wysłane dopiero po zatwierdzeniu. Nawiew i wywiew ustawiasz suwakiem lub przyciskami. Żadna zmiana nie zostanie wysłana, dopóki nie klikniesz „Wyślij nastawy”.</p>${this._touchNumber('Nawiew','supply',this._draft.supply,80,370,10,'m³/h')}${this._touchNumber('Wywiew','extract',this._draft.extract,80,370,10,'m³/h')}<button type="button" class="btn match-btn" data-action="match-flow">↔ Ustaw taką samą wydajność nawiewu i wywiewu</button>`,'Wyślij nastawy','manual-confirm');return;}
    if(action==='airing'){const n=Number(this._config.airing_default_minutes ?? 15);this._draft={minutes:String(Number.isFinite(n)?n:15)};const min=5,max=95,step=1;this._draft.airMin=min;this._draft.airMax=max;this._draft.airStep=step;this._show('Przewietrzanie',`${this._touchNumber('Czas przewietrzania','minutes',this._draft.minutes,min,max,step,'min')}<div class="presets">${[5,10,15,30,60].filter(v=>v>=min&&v<=max&&Math.abs((v-min)/step-Math.round((v-min)/step))<1e-6).map(v=>`<button type="button" class="btn preset-btn" data-action="preset-time" data-value="${v}">${v} min</button>`).join('')}</div>`,'Uruchom','airing-confirm');return;}
    if(action==='comfort'){const entity=this._hass.states['number.rekuperator_ustaw_temp_komfortu'];const n=Number(this._value('number.rekuperator_ustaw_temp_komfortu',22));this._draft={comfort:String(Number.isFinite(n)?n:22)};this._show('Temperatura komfortu',this._touchNumber('Temperatura komfortu','comfort',this._draft.comfort,Number(entity?.attributes?.min??10),Number(entity?.attributes?.max??35),Number(entity?.attributes?.step??1),'°C'),'Ustaw','comfort-confirm');return;}
    if(action==='bypass'){this._draft={bypass:'2'};this._show('Sterowanie bypassem','<p>Wybierz sposób pracy przepustnicy. Polecenie wyśle się dopiero po zatwierdzeniu.</p><div class="choice-grid"><button type="button" class="choice-btn selected" data-action="choose-bypass" data-value="2" aria-pressed="true">Automatyczny</button><button type="button" class="choice-btn" data-action="choose-bypass" data-value="1" aria-pressed="false">Otwarty ręcznie</button><button type="button" class="choice-btn" data-action="choose-bypass" data-value="0" aria-pressed="false">Zamknięty ręcznie</button></div>','Wyślij','bypass-confirm');return;}
    if(action==='filters'){this._show('Reset licznika filtrów','<p>Czy filtry zostały fizycznie wymienione? Resetuj licznik wyłącznie po ich wymianie.</p>','Tak, wymieniłem filtry','filters-confirm');return;}
    if(action==='power-confirm'){this._call('switch',this._isOn()?'turn_off':'turn_on',{entity_id:'switch.rekuperator_zasilanie'});return;}
    if(action==='auto-confirm'){this._call('button','press',{entity_id:'button.rekuperator_aktywuj_tryb_inteligentny'});return;}
    if(action==='holiday-confirm'){this._call('button','press',{entity_id:'button.rekuperator_aktywuj_urlop'});return;}
    if(action==='manual-confirm'){const a=this._checkNumber('supply',80,370,10),b=this._checkNumber('extract',80,370,10);if(a===null||b===null)return;this._call('req_rekuperator','manual_airflow',{entry_id:this._resolvedEntryId,supply:a,extract:b});return;}
    if(action==='airing-confirm'){const n=this._checkNumber('minutes',this._draft.airMin,this._draft.airMax,this._draft.airStep);if(n===null)return;this._call('req_rekuperator','airing',{entry_id:this._resolvedEntryId,minutes:n});return;}
    if(action==='comfort-confirm'){const ent=this._hass.states['number.rekuperator_ustaw_temp_komfortu'];const n=this._checkNumber('comfort',Number(ent?.attributes?.min??10),Number(ent?.attributes?.max??35),Number(ent?.attributes?.step??1));if(n===null)return;this._call('number','set_value',{entity_id:'number.rekuperator_ustaw_temp_komfortu',value:n});return;}
    if(action==='bypass-confirm'){const mode=Number(this._draft.bypass);if(![0,1,2].includes(mode))return;this._call('req_rekuperator','bypass',{entry_id:this._resolvedEntryId,mode});return;}
    if(action==='filters-confirm'){this._call('req_rekuperator','replace_filters',{entry_id:this._resolvedEntryId});return;}
  }
}
if(!customElements.get('req-rekuperator-card'))customElements.define('req-rekuperator-card',RekuperatorCard);
window.customCards=window.customCards||[];window.customCards.push({type:'req-rekuperator-card',name:'Rekuperator reQ — sterowanie',description:'Responsywny panel rekuperatora z animowanym wymiennikiem'});

})();

(()=>{
/*
 * Rekuperator reQ 0.1.12 — wykresy Canvas (zintegrowane)
 * Chart rendering is self-contained and does not use external charting libraries.
 * History source: Home Assistant Recorder REST API.
 * Live refresh of today's range; preserve zoom/pan while refreshing.
 * Responsive chart height, compact single-line mobile metrics and dismissible tooltip.
 * Exact Recorder state-transition overlays (no inferred/backdated bypass operation).
 */

const VERSION = '0.1.12';
const RANGE_OPTIONS = ['1 dzień', '3 dni', '7 dni', 'Od–do'];
const RANGE_DAYS = { '1 dzień': 1, '3 dni': 3, '7 dni': 7 };

const DEFAULT_CHARTS = [
  {
    id: 'temperatures',
    title: 'Temperatury i sprawność odzysku',
    leftAxis: { label: 'Temperatura', unit: '°C', min: null, max: null },
    rightAxis: { label: 'Sprawność', unit: '%', min: 0, max: 100 },
    series: [
      { entity: 'sensor.rekuperator_stan_bypassu', name: 'Bypass (otwarty)', color: '#00d2d3', type: 'area', axis: 'none', transform: 'includes-open', aggregation: 'max', opacity: 0.20, unit: '' },
      { entity: 'binary_sensor.rekuperator_grzalka_wstepna', name: 'Grzałka', color: '#ff6b6b', type: 'area', axis: 'none', transform: 'is-on', aggregation: 'max', opacity: 0.27, unit: '' },
      { entity: 'sensor.rekuperator_temperatura_czerpnia', name: 'Czerpnia', color: '#00a8ff', axis: 'left', unit: '°C', aggregation: 'avg' },
      { entity: 'sensor.rekuperator_temperatura_nawiew', name: 'Nawiew', color: '#e1b12c', axis: 'left', unit: '°C', aggregation: 'avg' },
      { entity: 'sensor.rekuperator_temperatura_wywiew', name: 'Wywiew', color: '#e84118', axis: 'left', unit: '°C', aggregation: 'avg' },
      { entity: 'sensor.rekuperator_temperatura_wyrzutnia', name: 'Wyrzutnia', color: '#4cd137', axis: 'left', unit: '°C', aggregation: 'avg' },
      { entity: 'sensor.rekuperator_sprawnosc', name: 'Sprawność', color: '#9c88ff', axis: 'right', unit: '%', aggregation: 'avg', min: 0, max: 100, connectGaps: true }
    ]
  },
  {
    id: 'air-quality',
    title: 'Jakość powietrza — CO₂ i wilgotność',
    leftAxis: { label: 'CO₂', unit: 'ppm', min: null, max: null },
    rightAxis: { label: 'Wilgotność', unit: '%', min: 0, max: 100 },
    series: [
      { entity: 'sensor.rekuperator_stan_bypassu', name: 'Bypass (otwarty)', color: '#00d2d3', type: 'area', axis: 'none', transform: 'includes-open', aggregation: 'max', opacity: 0.20, unit: '' },
      { entity: 'binary_sensor.rekuperator_grzalka_wstepna', name: 'Grzałka', color: '#ff6b6b', type: 'area', axis: 'none', transform: 'is-on', aggregation: 'max', opacity: 0.27, unit: '' },
      { entity: 'sensor.rekuperator_co2', name: 'Stężenie CO₂', color: '#e84118', axis: 'left', unit: 'ppm', aggregation: 'avg', min: 250 },
      { entity: 'sensor.rekuperator_wilgotnosc', name: 'Wilgotność', color: '#00a8ff', axis: 'right', unit: '%', aggregation: 'avg', min: 1, max: 100 }
    ]
  },
  {
    id: 'airflow-power',
    title: 'Wydajność wentylacji i pobór mocy',
    leftAxis: { label: 'Przepływ', unit: 'm³/h', min: 0, max: null },
    rightAxis: { label: 'Moc wentylatorów', unit: 'W', min: 0, max: null },
    series: [
      { entity: 'sensor.rekuperator_stan_bypassu', name: 'Bypass (otwarty)', color: '#00d2d3', type: 'area', axis: 'none', transform: 'includes-open', aggregation: 'max', opacity: 0.20, unit: '' },
      { entity: 'binary_sensor.rekuperator_grzalka_wstepna', name: 'Grzałka', color: '#ff6b6b', type: 'area', axis: 'none', transform: 'is-on', aggregation: 'max', opacity: 0.27, unit: '' },
      { entity: 'sensor.rekuperator_predkosc_nawiewu', name: 'Nawiew', color: '#fbc531', axis: 'left', unit: 'm³/h', aggregation: 'avg', min: 0 },
      { entity: 'sensor.rekuperator_predkosc_wywiewu', name: 'Wywiew', color: '#4cd137', axis: 'left', unit: 'm³/h', aggregation: 'avg', min: 0 },
      { entity: 'sensor.rekuperator_sumaryczny_pobor_mocy', name: 'Moc wentylatorów', color: '#9c88ff', axis: 'right', unit: 'W', aggregation: 'avg', min: 0 }
    ]
  }
];

class RekuperatorCharts extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = null;
    this._chartIndex = 0;
    this._range = '1 dzień';
    this._offset = 0;
    this._viewport = null;
    this._plot = null;
    this._chartData = new Map();
    this._smoothedCache = new WeakMap();
    this._loading = false;
    this._requestId = 0;
    this._visible = new Set();
    this._pointers = new Map();
    this._gesture = null;
    this._resizeObserver = null;
    this._pollTimer = null;
    this._intersectionObserver = null;
    this._elementInView = true;
    this._visibilityHandler = () => this._pollTick();
    this._outsidePointerHandler = event => {
      // A tap outside the plot closes an open mobile tooltip; never steal plot gestures.
      const plot = this.shadowRoot.querySelector('canvas');
      if (plot && !event.composedPath().includes(plot) && this._tooltipAnchor) this._hideTooltip();
    };
    this._resizeHandler = () => this._scheduleLayout();
    this._layoutFrame = null;
    this._lastAttemptAt = 0;
    this._tooltipAnchor = null;
    this._rendered = false;
  }

  setConfig(config) {
    if (!config) throw new Error('Wymagana konfiguracja integracji REQNET.');
    const chartDefinitions = Array.isArray(config.charts) && config.charts.length ? config.charts : DEFAULT_CHARTS;
    this._sourceCharts = chartDefinitions.map((chart, i) => this._normalizeChart(chart, i));
    this._requestId++;
    this._chartData.clear();
    this._currentData = null;
    this._visible.clear();
    this._config = { ...config, charts: this._sourceCharts };
    this._chartIndex = 0;
    this._range = RANGE_OPTIONS.includes(config.default_range) ? config.default_range : '1 dzień';
    this._customRange = null;
    this._cursorTime = null;
    this._offset = 0;
    this._viewport = null;
    this._reqSignature = null;
    this._renderShell();
    if (this._hass) this.hass = this._hass;
  }

  set hass(value) {
    const first = !this._hass;
    this._hass = value;
    if (!this._config) return;
    const selection = ReqAdapter.select(value, this._config.entry_id);
    const signature = JSON.stringify([selection.entryId, selection.aliases]);
    if (signature !== this._reqSignature) {
      this._reqSignature = signature;
      this._reqSelection = selection;
      this._visible.clear();this._chartData.clear();this._currentData = null;
      this._requestId++;
      this._config.charts = this._sourceCharts.map(chart => ({...chart,series:chart.series.map(series =>
        ({...series, entity: ReqAdapter.resolve(series.entity, selection) || 'sensor.reqnet_missing'}))}));
      this._loadChart();
    } else if (first && selection.ready) this._loadChart();
    else this._updateMetrics();
    this._draw();
  }

  get hass() { return this._hass; }

  connectedCallback() {
    if (this._config && !this._rendered) this._renderShell();
    if (this._hass && this._config) this._loadChart();
    this._resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(entries => {
          if (entries.some(entry => entry.target.classList.contains('canvas-wrap'))) this._draw();
          this._scheduleLayout();
        }) : null;
    if (this._resizeObserver) {
      for (const selector of ['.canvas-wrap', '.metrics', '.toolbar', '.legend']) {
        const element = this.shadowRoot.querySelector(selector);
        if (element) this._resizeObserver.observe(element);
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._visibilityHandler);
      document.addEventListener('pointerdown', this._outsidePointerHandler, { passive: true });
    }
    window.addEventListener('resize', this._resizeHandler);
    window.visualViewport?.addEventListener('resize', this._resizeHandler);
    if (typeof IntersectionObserver !== 'undefined') {
      this._intersectionObserver = new IntersectionObserver(entries => {
        const visible = entries.some(entry => entry.isIntersecting);
        const wasVisible = this._elementInView;
        this._elementInView = visible;
        if (visible && !wasVisible) this._pollTick();
      }, { threshold: 0.01 });
      this._intersectionObserver.observe(this);
    }
    // Lightweight check each minute; REST is called only for live ranges that are due.
    if (this._pollTimer) window.clearInterval(this._pollTimer);
    this._pollTimer = window.setInterval(() => this._pollTick(), 60 * 1000);
    this._scheduleLayout();
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
    this._intersectionObserver?.disconnect();
    if (this._pollTimer) window.clearInterval(this._pollTimer);
    this._pollTimer = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      document.removeEventListener('pointerdown', this._outsidePointerHandler);
    }
    window.removeEventListener('resize', this._resizeHandler);
    window.visualViewport?.removeEventListener('resize', this._resizeHandler);
    if (this._layoutFrame != null) window.cancelAnimationFrame?.(this._layoutFrame);
    this._layoutFrame = null;
    this._requestId++;
  }

  _pollTick() {
    if (!this.isConnected || !this._config || !this._hass || this._loading) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!this._elementInView) return;
    const now = Date.now();
    const bounds = this._rangeBounds();
    // Do not poll completed historical periods; range changes are loaded on demand.
    if (now < bounds.start.getTime() || now >= bounds.end.getTime()) return;
    const interval = this._range === '1 dzień' ? 60 * 1000 : 5 * 60 * 1000;
    const samePeriod = this._currentData
      && this._currentData.chartId === this._activeChart()?.id
      && this._currentData.bounds.start.getTime() === bounds.start.getTime()
      && this._currentData.bounds.end.getTime() === bounds.end.getTime();
    if (!samePeriod || now - Math.max(this._currentData.cachedAt, this._lastAttemptAt) >= interval) {
      this._loadChart(true);
    }
  }

  _scheduleLayout() {
    if (!this.isConnected || this._layoutFrame != null) return;
    this._layoutFrame = window.requestAnimationFrame(() => {
      this._layoutFrame = null;
      this._fitChartHeight();
    });
  }

  _fitChartHeight() {
    const wrap = this.shadowRoot.querySelector('.canvas-wrap');
    const legend = this.shadowRoot.querySelector('.legend');
    if (!wrap) return;
    const top = wrap.getBoundingClientRect().top;
    if (!Number.isFinite(top) || top < 0) return;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return;
    const legendHeight = legend?.getBoundingClientRect().height || 0;
    // Legend, card padding, safe viewport bottom. Never let the plot be too small.
    const available = viewportHeight - top - legendHeight - 46;
    const target = Math.max(300, Math.min(1600, Math.floor(available)));
    if (Math.abs(wrap.getBoundingClientRect().height - target) > 1) {
      wrap.style.height = `${target}px`;
    }
  }

  getCardSize() { return 8; }

  _normalizeChart(chart, index) {
    if (!chart || !Array.isArray(chart.series) || !chart.series.length) {
      throw new Error(`Rekuperator Charts: wykres ${index + 1} nie ma serii.`);
    }
    return {
      id: String(chart.id || `chart-${index + 1}`),
      title: String(chart.title || `Wykres ${index + 1}`),
      leftAxis: { label: 'Wartość', unit: '', min: null, max: null, ...(chart.leftAxis || {}) },
      rightAxis: chart.rightAxis ? { label: 'Wartość', unit: '', min: null, max: null, ...chart.rightAxis } : null,
      series: chart.series.map(series => ({
        entity: String(series.entity || ''),
        name: String(series.entity) === 'sensor.rekuperator_stan_bypassu' ? 'Bypass' : String(series.name || series.entity || 'Seria'),
        color: String(series.color || '#8ab4f8'),
        type: series.type === 'area' ? 'area' : 'line',
        axis: series.axis || 'left',
        unit: String(series.unit || ''),
        transform: series.transform || null,
        aggregation: series.aggregation === 'max' ? 'max' : 'avg',
        opacity: Number.isFinite(Number(series.opacity)) ? Number(series.opacity) : 0.18,
        min: series.min == null ? null : Number(series.min),
        max: series.max == null ? null : Number(series.max),
        connectGaps: Boolean(series.connectGaps)
      }))
    };
  }

  _renderShell() {
    
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;color:var(--primary-text-color,#eaf0f5);font-family:var(--paper-font-body1_-_font-family,Roboto,"Arial",sans-serif);--rc-bg:var(--ha-card-background,var(--card-background-color,#17232d));--rc-panel:rgba(255,255,255,.045);--rc-line:rgba(180,205,220,.13);--rc-muted:var(--secondary-text-color,#a9bac6);}
        *{box-sizing:border-box}.card{display:block;background:var(--rc-bg);border:1px solid var(--rc-line);border-radius:18px;padding:clamp(12px,2.2vw,22px);box-shadow:0 8px 28px rgba(0,0,0,.16);overflow:hidden}
        .heading,.chart-title{display:none}.eyebrow,.main-title,.version{display:none}
        .chart-top{display:flex;align-items:center;justify-content:flex-start;gap:7px;margin:12px 0 14px;min-width:0}.tabs{display:flex;flex:1 1 auto;gap:7px;margin:0;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px;min-width:0}.back-control{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:38px;height:36px;border:1px solid var(--rc-line);background:var(--rc-panel);color:var(--primary-text-color,#eaf0f5);border-radius:10px;font:inherit;font-size:12px;font-weight:650;font-size:19px;padding:0;min-height:36px;cursor:pointer;white-space:nowrap}.back-control:focus-visible{outline:2px solid var(--primary-color,#00a8ff);outline-offset:2px}.tab,.control,.range{border:1px solid var(--rc-line);background:var(--rc-panel);color:var(--primary-text-color,#eaf0f5);border-radius:10px;font:inherit;cursor:pointer;min-height:36px;white-space:nowrap}.tab{padding:8px 13px;font-size:12px;font-weight:650}.tab[aria-pressed=true],.range[aria-pressed=true]{background:rgba(62,146,205,.2);border-color:rgba(72,166,231,.55);color:var(--primary-text-color,#fff)}
        .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(172px,1fr));gap:6px;margin:2px 0 8px}.metric{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;padding:7px 9px;border:1px solid var(--rc-line);border-radius:9px;background:var(--rc-panel)}.metric-label{font-size:14px;color:var(--rc-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.metric-value{font-size:clamp(15px,1.8vw,18px);font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}.metric-value small{font-size:1em;color:var(--rc-muted);font-weight:500;margin-left:2px}
        .toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:9px;margin:10px 0}.ranges,.nav-controls,.zoom-controls{display:flex;gap:6px;align-items:center}.range,.control{padding:7px 10px;font-size:11px;font-weight:650;min-height:34px}.control:disabled{opacity:.35;cursor:default}.control.primary{background:rgba(50,140,200,.18);border-color:rgba(72,166,231,.45)}.range{padding:7px 9px}
        .date-range{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.date-range[hidden]{display:none}.date-range label{font-size:10px;color:var(--rc-muted);display:flex;gap:4px;align-items:center}.date-range input{background:var(--rc-panel);color:var(--primary-text-color);border:1px solid var(--rc-line);border-radius:8px;padding:6px;min-height:32px}.period-box{display:flex;flex:1;min-width:205px;flex-direction:column;align-items:center;gap:3px}.period{font-size:clamp(13px,1.45vw,16px);font-weight:700;color:var(--primary-text-color,#eaf0f5);font-variant-numeric:tabular-nums;text-align:center}.freshness{font-size:10px;color:var(--rc-muted);min-height:12px;white-space:nowrap}.freshness:empty{visibility:hidden}.status{font-size:12px;color:var(--rc-muted);padding:9px 2px;min-height:30px}.status.error{color:#ff9b9b}.retry{margin:0 0 8px 2px}.status[hidden],.retry[hidden]{display:none}.legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin:10px 2px 0}.legend-item{display:inline-flex;align-items:center;gap:6px;border:0;padding:2px 0;background:none;color:var(--primary-text-color,#eaf0f5);font-size:11px;cursor:pointer;opacity:1}.legend-item[aria-pressed=false]{opacity:.38}.swatch{width:17px;height:3px;border-radius:5px;display:inline-block}.swatch.area{height:9px;border-radius:3px;opacity:.8}
        .canvas-wrap{position:relative;width:100%;height:420px;min-height:300px;border:1px solid var(--rc-line);border-radius:13px;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(0,0,0,.035));overflow:hidden}.plot{display:block;width:100%;height:100%;touch-action:none;cursor:crosshair;outline:none}.tooltip{position:absolute;z-index:3;pointer-events:none;display:none;max-width:calc(100% - 16px);padding:9px 11px;background:rgba(9,18,25,.94);border:1px solid rgba(180,210,225,.24);border-radius:10px;box-shadow:0 6px 22px rgba(0,0,0,.32);font-size:11px;color:#f2f7fa;white-space:nowrap}.tooltip-time{color:#aebfca;margin-bottom:5px}.tip-row{display:flex;justify-content:space-between;gap:16px;margin:2px 0}.tip-name{display:flex;gap:6px;align-items:center}.tip-dot{width:7px;height:7px;border-radius:50%;display:inline-block}.gesture-note{display:none}
        @media(max-width:700px){.card{padding:10px;border-radius:14px}.chart-top{flex-wrap:nowrap;gap:5px;margin:4px 0 8px}.tabs{flex:1 1 auto;gap:5px}.back-control{width:36px;height:34px;min-height:34px;font-size:19px}.tab{padding:8px 10px;min-height:34px}.metrics{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.metric{padding:8px 5px;display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:3px;min-height:37px}.metric-label{min-width:0;flex:1 1 auto;font-size:clamp(10.5px,3vw,12px);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.metric-value{flex:0 0 auto;font-size:clamp(12px,3.5vw,17px);line-height:1.2;align-self:center}.metric-value small{font-size:1em;margin-left:1px}.toolbar{align-items:flex-start;margin-bottom:4px}.ranges{width:100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}.range{min-width:0;padding:6px 3px;font-size:10px}.nav-controls{flex:1}.zoom-controls{margin-left:auto}.date-range{width:100%;order:2}.date-range input{max-width:125px;min-width:0}.period-box{flex-basis:100%;order:3;min-width:0;padding-left:2px;display:flex;flex-direction:row;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:3px 8px}.period{text-align:left;font-size:clamp(12px,3.35vw,16px);flex:0 1 auto}.freshness{font-size:clamp(9px,2.2vw,10px);min-height:0;white-space:nowrap;margin-left:auto}.canvas-wrap{height:380px;min-height:300px}.tooltip{font-size:10px;padding:8px 9px}.tip-row{gap:10px}.legend{gap:7px 11px}.legend-item{font-size:10px}.gesture-note{display:block}.version{display:none}}
        @media(max-width:375px){.tabs{gap:4px}.tab{font-size:11px;padding:8px 5px}}
        @media(max-width:335px){.tab{font-size:10px;padding:8px 3px}}
        @media(max-width:355px){.metrics{gap:4px}.metric{padding:7px 3px;gap:2px}.metric-label{letter-spacing:-.12px}.metric-value{font-size:clamp(11.5px,3.5vw,17px)}}
        @media(prefers-reduced-motion:no-preference){.tab,.control,.range,.legend-item{transition:background .15s,border-color .15s,opacity .15s}}
      </style>
      <ha-card class="card">
        
        <div class="chart-top"><button type="button" class="back-control" data-action="back-to-control" title="Powrót do sterowania" aria-label="Wróć do sterowania">←</button><div class="tabs" role="tablist" aria-label="Rodzaj wykresu"></div></div>
        <div class="metrics"></div>
        <div class="toolbar">
          <div class="ranges" aria-label="Zakres czasu"></div>
          <div class="date-range" hidden>
            <label>Od <input type="date" class="date-start"></label>
            <label>Do <input type="date" class="date-end"></label>
            <button class="control primary" data-action="apply-dates">Pokaż</button>
          </div>
          <div class="nav-controls">
            <button class="control" data-action="older" title="Starszy zakres" aria-label="Starszy zakres">‹</button>
            <button class="control" data-action="newer" title="Nowszy zakres" aria-label="Nowszy zakres">›</button>
            <button class="control primary" data-action="now">Teraz</button>
          </div>
          <div class="period-box"><div class="period"></div><div class="freshness" aria-live="polite"></div></div>
          <div class="zoom-controls">
            <button class="control" data-action="zoom-out" title="Oddal" aria-label="Oddal">−</button>
            <button class="control" data-action="zoom-in" title="Przybliż" aria-label="Przybliż">+</button>
            <button class="control" data-action="zoom-reset">Reset zoom</button>
          </div>
        </div>
        <div class="status" role="status">Oczekiwanie na Home Assistant…</div>
        <button class="control retry" data-action="retry" hidden>Ponów pobieranie</button>
        <div class="canvas-wrap"><canvas class="plot" aria-label="Wykres historii czujników"></canvas><div class="tooltip"></div></div>
        <div class="legend"></div>
      </ha-card>`;
    this._renderControls();
    this._bindEvents();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      const wrap = this.shadowRoot.querySelector('.canvas-wrap');
      if (wrap) this._resizeObserver.observe(wrap);
    }
    this._rendered = true;
    this._updateMetrics();
    this._scheduleLayout();
    this._draw();
  }

  _renderControls() {
    const tabs = this.shadowRoot.querySelector('.tabs');
    tabs.replaceChildren();
    this._config.charts.forEach((chart, i) => {
      const button = document.createElement('button');
      button.className = 'tab'; button.type = 'button'; button.dataset.chart = String(i);
      button.textContent = ['Temperatury', 'Jakość powietrza', 'Przepływ i moc'][i] || chart.title;
      button.setAttribute('aria-pressed', String(i === this._chartIndex));
      tabs.append(button);
    });
    const ranges = this.shadowRoot.querySelector('.ranges');
    ranges.replaceChildren();
    RANGE_OPTIONS.forEach(range => {
      const button = document.createElement('button');
      button.className = 'range'; button.type = 'button'; button.dataset.range = range; button.textContent = range;
      button.setAttribute('aria-pressed', String(range === this._range));
      ranges.append(button);
    });
    const startInput = this.shadowRoot.querySelector('.date-start');
    const endInput = this.shadowRoot.querySelector('.date-end');
    const today = new Date();
    const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (startInput && !startInput.value) startInput.value = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate()-6));
    if (endInput && !endInput.value) endInput.value = iso(today);
    this._updateActiveControls();
  }

  _bindEvents() {
    if (!this._eventsBound) {
      this._eventsBound = true;
      this.shadowRoot.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.chart != null) {
          const next = Number(button.dataset.chart);
          if (Number.isInteger(next) && next >= 0 && next < this._config.charts.length) {
            this._chartIndex = next; this._visible.clear(); this._viewport = null; this._renderControls(); this._loadChart();
          }
          return;
        }
        if (button.dataset.range) {
          this._range = button.dataset.range; this._offset = 0; this._viewport = null;
          const picker = this.shadowRoot.querySelector('.date-range');
          if (picker) picker.hidden = this._range !== 'Od–do';
          if (this._range !== 'Od–do') { this._customRange = null; this._loadChart(); }
          this._updateActiveControls();
          return;
        }
        if (button.dataset.series) {
          const id = button.dataset.series;
          if (this._visible.has(id)) this._visible.delete(id); else this._visible.add(id);
          button.setAttribute('aria-pressed', String(!this._visible.has(id)));
          this._draw(); return;
        }
        switch (button.dataset.action) {
          case 'back-to-control': {
            // Ten sam mechanizm nawigacji HA co przycisk przejscia do wykresow.
            reqNavigateToSibling('sterowanie', this._config?.back_path);
            break;
          }
          case 'retry': this._loadChart(true); break;
          case 'apply-dates': {
            const from = this.shadowRoot.querySelector('.date-start')?.value;
            const to = this.shadowRoot.querySelector('.date-end')?.value;
            if (!from || !to || from > to) { this._setStatus('Wybierz poprawny zakres dat — data „Od” nie może być późniejsza niż „Do”.', true); break; }
            const start = new Date(`${from}T00:00:00`);
            const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate()+1);
            this._customRange = { start, end }; this._offset = 0; this._viewport = null; this._loadChart(); break;
          }
          case 'older': this._offset += 1; this._viewport = null; this._updateActiveControls(); this._loadChart(); break;
          case 'newer': if (this._offset > 0) { this._offset -= 1; this._viewport = null; this._updateActiveControls(); this._loadChart(); } break;
          case 'now': this._offset = 0; this._range = '1 dzień'; this._customRange = null; this._viewport = null; this._renderControls(); this._loadChart(); break;
          case 'zoom-in': this._zoomAt(0.5, 0.72); break;
          case 'zoom-out': this._zoomAt(0.5, 1.38); break;
          case 'zoom-reset': this._viewport = null; this._draw(); break;
        }
      });
    }
    const canvas = this.shadowRoot.querySelector('canvas');
    if (!canvas || canvas === this._boundCanvas) return;
    this._boundCanvas = canvas;
    canvas.addEventListener('pointerdown', event => this._pointerDown(event));
    canvas.addEventListener('pointermove', event => this._pointerMove(event));
    canvas.addEventListener('pointerup', event => this._pointerUp(event));
    canvas.addEventListener('pointercancel', event => this._pointerUp(event));
    canvas.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && !this._gesture) this._hideTooltip(); });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      this._zoomAt(this._plot ? (x - this._plot.left) / this._plot.width : 0.5, event.deltaY < 0 ? 0.82 : 1.22);
    }, { passive: false });
  }

  _activeChart() { return this._config?.charts[this._chartIndex]; }

  _updateActiveControls() {
    this.shadowRoot.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.chart) === this._chartIndex)));
    this.shadowRoot.querySelectorAll('.range').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === this._range)));
    const newer = this.shadowRoot.querySelector('[data-action="newer"]');
    if (newer) newer.disabled = this._offset === 0;
    const period = this.shadowRoot.querySelector('.period');
    if (period) period.textContent = this._formatPeriod(this._rangeBounds());
    const picker = this.shadowRoot.querySelector('.date-range');
    if (picker) picker.hidden = this._range !== 'Od–do';
    this._scheduleLayout();
  }

  _localMidnight(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0); }
  _addDays(date, days) { const result = new Date(date); result.setDate(result.getDate() + days); return result; }

  _rangeBounds() {
    const now = new Date();
    if (this._range === 'Od–do' && this._customRange) {
      const duration = this._customRange.end.getTime() - this._customRange.start.getTime();
      const shift = this._offset * duration;
      return { start: new Date(this._customRange.start.getTime() - shift), end: new Date(this._customRange.end.getTime() - shift) };
    }
    const days = RANGE_DAYS[this._range] || 1;
    const today = this._localMidnight(now);
    const start = this._addDays(today, -(this._offset * days + days - 1));
    return { start, end: this._addDays(start, days) };
  }

  _formatPeriod(bounds) {
    if (!bounds) return '';
    const fmt = d => d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (this._range === '1 dzień') return `${fmt(bounds.start)} · 00:00–24:00`;
    return `${fmt(bounds.start)} 00:00 – ${fmt(new Date(bounds.end.getTime() - 1))} 24:00`;
  }

  _bucketMs() {
    // Count local calendar days, not 24-hour blocks: a day with a DST clock
    // change can last 23 or 25 hours, but still needs the 1-minute bucket.
    const days = this._range === 'Od–do' && this._customRange
      ? Math.max(1, Math.round((
          Date.UTC(this._customRange.end.getFullYear(), this._customRange.end.getMonth(), this._customRange.end.getDate()) -
          Date.UTC(this._customRange.start.getFullYear(), this._customRange.start.getMonth(), this._customRange.start.getDate())
        ) / 86400000))
      : (RANGE_DAYS[this._range] || 1);
    if (days <= 1) return 60 * 1000;
    if (days <= 3) return 15 * 60000;
    return 30 * 60000;
  }

  _setFreshness(cachedAt, note = '', sampledUntil = null) {
    const element = this.shadowRoot.querySelector('.freshness');
    if (!element) return;
    const format = value => new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    // Czas ostatniego zakończonego pobrania historii (jak w wersji 3.1.0).
    // sampledUntil jest zachowane w danych wewnętrznych dla wykresu i tooltipa,
    // ale nie jest wyświetlane jako dodatkowa godzina w nagłówku.
    const updated = Number.isFinite(cachedAt) ? `Aktualizacja: ${format(cachedAt)}` : '';
    element.textContent = [updated, note].filter(Boolean).join(' · ');
  }

  async _loadChart(force = false) {
    if (!this._hass || !this._config || !this.isConnected) return;
    if (!this._reqSelection?.entryId) {
      this._loading = false;
      this._setStatus('Nie znaleziono urządzenia integracji reQ. Sprawdź entry_id.');
      return;
    }
    const chart = this._activeChart();
    if (!chart) return;
    const bounds = this._rangeBounds();
    const periodKey = this._range === 'Od–do' ? `${bounds.start.toISOString()}|${bounds.end.toISOString()}` : bounds.start.toDateString();
    const key = `${chart.id}|${this._range}|${this._offset}|${periodKey}`;
    const requestId = ++this._requestId;
    this._updateActiveControls();
    this._updateMetrics();
    const oldData = this._currentData;
    const samePeriod = oldData && oldData.chartId === chart.id
      && oldData.bounds.start.getTime() === bounds.start.getTime()
      && oldData.bounds.end.getTime() === bounds.end.getTime();
    const cached = this._chartData.get(key);
    const cacheFresh = cached && (this._offset > 0 || Date.now() - cached.cachedAt < 60000);
    if (!force && cacheFresh) {
      this._loading = false;
      this._currentData = cached;
      if (!samePeriod) { this._viewport = null; this._cursorTime = null; this._tooltipAnchor = null; this.shadowRoot.querySelector('.tooltip')?.style.setProperty('display','none'); }
      this._renderLegend();
      const cachedDiag=this._reqSelection?.byKey?.diagnostyka;
      const cachedOffline=!!cachedDiag && this._hass?.states?.[cachedDiag]?.state==='Brak odpowiedzi';
      this._setStatus(cachedOffline?'Brak aktualnej odpowiedzi MQTT z rekuperatora; starsza historia pozostaje dostępna.':
        (cached.valuePoints ? '' : 'Brak poprawnych danych liczbowych dla wybranych encji i okresu.'));
      this._setFreshness(cached.cachedAt, '', cached.sampledUntil);
      this._draw();
      return;
    }
    this._loading = true;
    this._lastAttemptAt = Date.now();
    // Keep the previous plot and user zoom visible while refreshing the same period.
    // Only clear the plot when the chart or the selected full date range changes.
    if (!samePeriod) {
      this._currentData = null;
      this._cursorTime = null;
      this._tooltipAnchor = null;
      const tooltip = this.shadowRoot.querySelector('.tooltip');
      if (tooltip) tooltip.style.display = 'none';
    }
    this._setStatus(samePeriod ? '' : 'Pobieranie historii z Home Assistant…');
    if (samePeriod) this._setFreshness(oldData.cachedAt, 'odświeżanie…', oldData.sampledUntil);
    else this._setFreshness(null);
    this._draw();
    const uniqueEntities = [...new Set(chart.series.map(series => series.entity).filter(entity => entity && entity !== 'sensor.reqnet_missing'))];
    const startForApi = new Date(bounds.start.getTime() - 24 * 3600000).toISOString();
    const endForApi = new Date(Math.min(bounds.end.getTime(), Date.now())).toISOString();
    const bucketMs = this._bucketMs();
    // Freeze the API cut-off before requesting history; never extrapolate past it.
    const dataEnd = Date.parse(endForApi);
    if (dataEnd <= bounds.start.getTime()) {
      const empty = { data: new Map(chart.series.map(series => [series.entity, []])), bounds, bucketMs, totalPoints: 0, valuePoints: 0, chartId: chart.id, cachedAt: Date.now(), sampledUntil: null };
      this._loading = false; this._currentData = empty; this._viewport = null;
      this._renderLegend(); this._setStatus('Wybrany zakres jest w przyszłości — historia pojawi się wraz z upływem czasu.');
      this._setFreshness(empty.cachedAt); this._draw(); return;
    }
    let timeoutId;
    try {
      const historyRequests = Promise.all(uniqueEntities.map(async entity => {
        const isStateOverlay = chart.series.some(series => series.entity === entity && series.type === 'area');
        const entityStart = isStateOverlay ? new Date(bounds.start.getTime() - 7 * 86400000).toISOString() : startForApi;
        const query = `history/period/${encodeURIComponent(entityStart)}?filter_entity_id=${encodeURIComponent(entity)}&minimal_response&no_attributes&end_time=${encodeURIComponent(endForApi)}`;
        const response = await this._hass.callApi('GET', query);
        return [entity, Array.isArray(response?.[0]) ? response[0] : []];
      }));
      const results = await Promise.race([
        historyRequests,
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error('Przekroczono limit 35 s pobierania historii Recorder.')), 35000);
        })
      ]);
      if (requestId !== this._requestId || !this.isConnected) return;
      const rawByEntity = new Map(results);
      const data = new Map();
      let totalPoints = 0;
      let valuePoints = 0;
      for (const series of chart.series) {
        const points = this._aggregate(rawByEntity.get(series.entity) || [], series, bounds, bucketMs, dataEnd);
        data.set(series.entity, points);
        totalPoints += points.length;
        if (series.axis !== 'none') valuePoints += points.filter(point => Number.isFinite(point.value)).length;
      }
      const sampleTimes = [...data.entries()]
        .filter(([entity]) => chart.series.some(series => series.entity === entity && series.type !== 'area'))
        .flatMap(([, points]) => points.filter(point => Number.isFinite(point.value)).map(point => point.time));
      const sampledUntil = sampleTimes.reduce((max, time) => Math.max(max, time), -Infinity);
      const payload = { data, bounds, bucketMs, totalPoints, valuePoints, chartId: chart.id, cachedAt: Date.now(), sampledUntil: Number.isFinite(sampledUntil) ? sampledUntil : null };
      this._chartData.set(key, payload);
      while (this._chartData.size > 15) this._chartData.delete(this._chartData.keys().next().value);
      this._currentData = payload;
      // Preserve pan/zoom when historical data is updated for the same full range.
      if (!samePeriod) this._viewport = null;
      this._renderLegend();
      const diagEntity=this._reqSelection?.byKey?.diagnostyka;
      const offline=!!diagEntity && this._hass?.states?.[diagEntity]?.state==='Brak odpowiedzi';
      this._setStatus(offline ? 'Rekuperator nie odpowiada przez MQTT. Historia sprzed utraty połączenia pozostaje dostępna; nowych pomiarów nie ma.' :
        (valuePoints ? '' : 'Brak poprawnych danych liczbowych. Sprawdź zapisy tych encji w Recorder.'));
      this._setFreshness(payload.cachedAt, '', payload.sampledUntil);
      this._draw();
      if (samePeriod && this._tooltipAnchor && this.shadowRoot.querySelector('.tooltip')?.style.display === 'block') {
        this._showTooltip(this._tooltipAnchor.x, this._tooltipAnchor.y);
      }
    } catch (error) {
      if (requestId !== this._requestId) return;
      // A failed refresh does not discard a previously displayed, valid plot.
      this._currentData = samePeriod ? oldData : null;
      this._setStatus(`Nie udało się pobrać historii z Home Assistant: ${error?.message || 'nieznany błąd'}.`, true, true);
      this._setFreshness(samePeriod ? oldData.cachedAt : null, 'błąd odświeżania', samePeriod ? oldData.sampledUntil : null);
      this._renderLegend(); this._draw();
      console.warn('[Rekuperator Charts] Recorder history request failed:', error?.message || error);
    } finally {
      if (timeoutId != null) window.clearTimeout(timeoutId);
      if (requestId === this._requestId) {
        this._loading = false;
        this._draw();
      }
    }
  }

  _aggregate(raw, series, bounds, bucketMs, dataEnd = Date.now()) {
    const records = raw.map(record => {
      const time = Date.parse(record.last_changed || record.last_updated || record[0]);
      const rawState = record.state ?? record[1];
      if (!Number.isFinite(time)) return null;
      let value;
      const normalizedState = String(rawState).toLowerCase();
      if (normalizedState === 'unknown' || normalizedState === 'unavailable' || rawState == null) return { time, value: null };
      if (series.transform === 'includes-open') {
        // Only explicit open-state reports count. Preserve the exact event time in Recorder.
        // Older configurations may contain the spelling 'Owarty'.
        value = /\b(?:otwarty|owarty)\b/i.test(String(rawState).trim()) ? 1 : 0;
      }
      else if (series.transform === 'is-on') value = normalizedState === 'on' ? 1 : normalizedState === 'off' ? 0 : null;
      else {
        value = Number(rawState);
        if (String(rawState).toLowerCase() === 'unknown' || String(rawState).toLowerCase() === 'unavailable' || !Number.isFinite(value)) return { time, value: null };
        if (series.min != null && value < series.min) return { time, value: null };
        if (series.max != null && value > series.max) return { time, value: null };
      }
      return { time, value };
    }).filter(Boolean).sort((a, b) => a.time - b.time);

    const isArea = series.type === 'area' && (series.transform === 'includes-open' || series.transform === 'is-on');
    if (isArea) {
      const start = bounds.start.getTime();
      const end = Math.min(bounds.end.getTime(), dataEnd);
      let baseline = null;
      for (const point of records) {
        if (point.time <= start) baseline = point;
        else break;
      }
      const transitions = records.filter(point => point.time > start && point.time <= end);
      let state = baseline ? baseline.value : null;
      let cursor = start;
      let firstTransition = 0;
      if (state == null && transitions.length) {
        state = transitions[0].value;
        cursor = transitions[0].time;
        firstTransition = 1;
      }
      const intervals = [];
      for (let i = firstTransition; i < transitions.length; i++) {
        const transition = transitions[i];
        if (state >= 0.5 && transition.time > cursor) {
          intervals.push({ time: cursor, start: cursor, end: transition.time, value: 1, count: 1 });
        }
        state = transition.value;
        cursor = transition.time;
      }
      if (state >= 0.5 && end > cursor) {
        intervals.push({ time: cursor, start: cursor, end, value: 1, count: 1 });
      }
      return intervals;
    }

    // Recorder records state changes. Build a regular sampled line by carrying
    // the last state forward; explicit unknown/unavailable values break it.
    const start = bounds.start.getTime();
    const end = Math.min(bounds.end.getTime(), dataEnd);
    let current = null;
    for (const point of records) { if (point.time <= start) current = point; else break; }
    const events = records.filter(point => point.time > start && point.time <= end);
    let eventIndex = 0;
    const output = [];
    for (let t = start; t <= end; t += bucketMs) {
      while (eventIndex < events.length && events[eventIndex].time <= t) current = events[eventIndex++];
      if (current) output.push({ time: t, start: t, end: Math.min(end, t + bucketMs), value: current.value, count: 1 });
    }
    // Include the query cut-off as the last point if a valid Recorder state is
    // known there. This is a carried-forward state, not a newly measured value.
    while (eventIndex < events.length && events[eventIndex].time <= end) current = events[eventIndex++];
    if (current && end > start && (!output.length || output[output.length - 1].time < end)) {
      output.push({ time: end, start: end, end, value: current.value, count: 1 });
    }
    return output;
  }

  _setStatus(message, error = false, showRetry = false) {
    const el = this.shadowRoot.querySelector('.status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', error);
    el.hidden = !message;
    const retry = this.shadowRoot.querySelector('[data-action="retry"]');
    if (retry) retry.hidden = !showRetry;
  }

  _updateMetrics() {
    const root = this.shadowRoot.querySelector('.metrics');
    const chart = this._activeChart();
    if (!root || !chart) return;
    root.replaceChildren();
    for (const series of chart.series.filter(s => s.axis !== 'none')) {
      const state = this._hass?.states?.[series.entity];
      const raw = state?.state;
      const numeric = Number(raw);
      const valid = raw != null && raw !== 'unknown' && raw !== 'unavailable' && Number.isFinite(numeric);
      const tile = document.createElement('div'); tile.className = 'metric';
      const label = document.createElement('div'); label.className = 'metric-label'; label.textContent = series.name;
      const value = document.createElement('div'); value.className = 'metric-value';
      value.textContent = valid ? numeric.toLocaleString('pl-PL', { maximumFractionDigits: 1 }) : '—';
      value.style.color = series.color;
      if (series.unit) { const unit = document.createElement('small'); unit.textContent = series.unit; value.append(unit); }
      tile.append(label, value); root.append(tile);
    }
    this._scheduleLayout();
  }

  _renderLegend() {
    const root = this.shadowRoot.querySelector('.legend');
    const chart = this._activeChart();
    if (!root || !chart) return;
    root.replaceChildren();
    // Kolejnosc tylko w legendzie: najpierw pomiary, potem bypass i grzalka.
    const displaySeries = [
      ...chart.series.filter(series => series.type !== 'area'),
      ...chart.series.filter(series => series.type === 'area')
    ];
    displaySeries.forEach(series => {
      const button = document.createElement('button'); button.className = 'legend-item'; button.type = 'button'; button.dataset.series = series.entity;
      const enabled = !this._visible.has(series.entity); // all series start visible; _visible stores hidden IDs
      button.setAttribute('aria-pressed', String(enabled));
      const swatch = document.createElement('span'); swatch.className = `swatch${series.type === 'area' ? ' area' : ''}`; swatch.style.background = series.color;
      if (series.type === 'area') swatch.style.opacity = String(series.opacity);
      const text = document.createElement('span'); text.textContent = series.name;
      button.append(swatch, text); root.append(button);
    });
    this._scheduleLayout();
  }

  // Wygładzanie zależy od próbkowania, a nie od nazwy zakresu.
  // Równoważne zakresy "1 dzień" i "Od–do" (<= 1 doba) muszą wyglądać tak samo.
  // Dla 15/30-minutowych próbek (3/7 dni) zachowujemy dotychczasowy wykres.
  // Tylko prezentacja: 5 próbek wstecz, bez przyszłości; dane Recorder,
  // tooltip, przerwy i obszary bypass/grzałki pozostają niezmienione.
  _displayPoints(chart, series, payload) {
    const raw = payload.data.get(series.entity) || [];
    const supported = chart && ['temperatures', 'air-quality', 'airflow-power'].includes(chart.id);
    if (!supported || series.type === 'area' || payload.bucketMs !== 60000) return raw;
    const cache = this._smoothedCache.get(raw);
    if (cache) return cache;
    const result = [];
    const trailing = [];
    let sum = 0, previousTime = null;
    for (const point of raw) {
      if (!Number.isFinite(point.value)) {
        trailing.length = 0;
        sum = 0;
        previousTime = point.time;
        result.push(point); // prawdziwa przerwa pozostaje przerwą
        continue;
      }
      if (previousTime !== null && point.time - previousTime > payload.bucketMs * 1.5) {
        trailing.length = 0;
        sum = 0; // bez uśredniania przez brakującą historię
      }
      previousTime = point.time;
      trailing.push(point.value);
      sum += point.value;
      if (trailing.length > 5) sum -= trailing.shift();
      result.push({ ...point, value: sum / trailing.length });
    }
    this._smoothedCache.set(raw, result);
    return result;
  }

  _draw() {
    const canvas = this.shadowRoot.querySelector('canvas');
    const wrap = this.shadowRoot.querySelector('.canvas-wrap');
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const width = Math.max(280, Math.floor(rect.width));
    const height = Math.max(220, Math.floor(rect.height));
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    }
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const chart = this._activeChart();
    const payload = this._currentData;
    if (!chart || !payload || payload.chartId !== chart.id) {
      this._plot = { left: 58, right: width - 54, top: 18, bottom: height - 43, width: width - 112, height: height - 61 };
      this._drawEmpty(ctx, width, height, this._loading ? 'Pobieranie historii…' : 'Brak danych do wyświetlenia');
      return;
    }
    const leftMargin = 58, rightMargin = chart.rightAxis ? 55 : 18, top = 28, bottom = height - 43;
    const plot = { left: leftMargin, right: width - rightMargin, top, bottom, width: width - leftMargin - rightMargin, height: bottom - top };
    this._plot = plot;
    const full = payload.bounds;
    const view = this._viewport || { start: full.start.getTime(), end: full.end.getTime() };
    const minView = 30000;
    const domain = { start: Math.max(full.start.getTime(), view.start), end: Math.min(full.end.getTime(), view.end) };
    if (domain.end - domain.start < minView) { domain.start = full.start.getTime(); domain.end = full.end.getTime(); this._viewport = null; }
    const x = time => plot.left + ((time - domain.start) / (domain.end - domain.start)) * plot.width;
    const visibleSeries = chart.series.filter(s => !this._visible.has(s.entity) && s.axis !== 'none');
    const axisValues = axis => {
      const values = [];
      for (const series of visibleSeries.filter(s => s.axis === axis)) {
        for (const point of payload.data.get(series.entity) || []) if (point.time >= domain.start && point.time <= domain.end && Number.isFinite(point.value)) values.push(point.value);
      }
      return values;
    };
    const getScale = (axisName, config) => {
      const values = axisValues(axisName);
      let min = config?.min != null ? Number(config.min) : (values.length ? Math.min(...values) : 0);
      let max = config?.max != null ? Number(config.max) : (values.length ? Math.max(...values) : 1);
      if (config?.min == null || config?.max == null) {
        const span = max - min;
        const pad = span > 0 ? span * 0.12 : Math.max(1, Math.abs(max) * 0.08);
        if (config?.min == null) min -= pad;
        if (config?.max == null) max += pad;
      }
      if (!Number.isFinite(min)) min = 0;
      if (!Number.isFinite(max) || max <= min) max = min + 1;
      return { min, max };
    };
    const leftScale = getScale('left', chart.leftAxis);
    const rightScale = chart.rightAxis ? getScale('right', chart.rightAxis) : null;
    const y = (value, axis) => {
      const scale = axis === 'right' && rightScale ? rightScale : leftScale;
      return plot.bottom - ((value - scale.min) / (scale.max - scale.min)) * plot.height;
    };

    // Grid and left/right axes.
    ctx.font = '10px Roboto, Arial, sans-serif'; ctx.lineWidth = 1; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(190,207,218,.78)'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(`${chart.leftAxis.label || 'Wartość'}${chart.leftAxis.unit ? ` (${chart.leftAxis.unit})` : ''}`, plot.left, 7);
    if (chart.rightAxis) {
      ctx.textAlign = 'right';
      ctx.fillText(`${chart.rightAxis.label || 'Wartość'}${chart.rightAxis.unit ? ` (${chart.rightAxis.unit})` : ''}`, plot.right, 7);
    }
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const ratio = i / 5, yy = plot.top + ratio * plot.height;
      const value = leftScale.max - ratio * (leftScale.max - leftScale.min);
      ctx.strokeStyle = 'rgba(170,195,210,.13)'; ctx.beginPath(); ctx.moveTo(plot.left, yy); ctx.lineTo(plot.right, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(185,202,213,.82)'; ctx.textAlign = 'right'; ctx.fillText(this._formatTick(value), plot.left - 9, yy);
      if (rightScale) {
        const rv = rightScale.max - ratio * (rightScale.max - rightScale.min);
        ctx.textAlign = 'left'; ctx.fillText(this._formatTick(rv), plot.right + 8, yy);
      }
    }
    ctx.fillStyle = 'rgba(185,202,213,.66)'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const time = domain.start + (domain.end - domain.start) * i / 4;
      let label;
      if (this._range === '1 dzień' && !this._viewport) label = ['00:00', '06:00', '12:00', '18:00', '24:00'][i];
      else if (domain.end - domain.start <= 86400000) label = new Date(time).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      else label = new Date(time).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
      ctx.fillText(label, plot.left + plot.width * i / 4, plot.bottom + 12);
    }
    // Translucent rectangular bypass/heater intervals, painted behind the lines.
    for (const series of chart.series.filter(s => s.type === 'area' && !this._visible.has(s.entity))) {
      const points = payload.data.get(series.entity) || [];
      ctx.fillStyle = series.color;
      ctx.globalAlpha = series.opacity;
      for (const point of points) {
        if (point.value < 0.5 || point.end <= domain.start || point.start >= domain.end) continue;
        const x1 = Math.max(plot.left, x(Math.max(point.start, domain.start)));
        const x2 = Math.min(plot.right, x(Math.min(point.end, domain.end)));
        if (x2 > x1) ctx.fillRect(x1, plot.top, x2 - x1, plot.height);
      }
      ctx.globalAlpha = 1;
    }
    // Sensor curves.
    for (const series of visibleSeries) {
      const points = this._displayPoints(chart, series, payload);
      if (!points.length) continue;
      ctx.strokeStyle = series.color; ctx.lineWidth = series.entity === 'sensor.rekuperator_sprawnosc' ? 1.8 : 2.1;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
      let started = false, prevTime = null;
      for (const point of points) {
        if (point.time < domain.start || point.time > domain.end) continue;
        if (point.value == null || !Number.isFinite(point.value)) { started = false; prevTime = point.time; continue; }
        const gap = prevTime != null && point.time - prevTime > payload.bucketMs * 2.5;
        if (!started || (gap && !series.connectGaps)) { ctx.moveTo(x(point.time), y(point.value, series.axis)); started = true; }
        else ctx.lineTo(x(point.time), y(point.value, series.axis));
        prevTime = point.time;
      }
      ctx.stroke();
    }
    // Synchronized crosshair: show only measurements reconstructed for the
    // exact same timestamp. Never project older values into future positions.
    if (this._cursorTime != null && this._cursorTime >= domain.start && this._cursorTime <= domain.end
        && this._cursorTime <= Math.min(payload.sampledUntil ?? -Infinity, Date.now())) {
      const cx = x(this._cursorTime);
      ctx.save(); ctx.strokeStyle = 'rgba(235,242,247,.82)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(cx, plot.top); ctx.lineTo(cx, plot.bottom); ctx.stroke(); ctx.setLineDash([]);
      for (const series of visibleSeries) {
        // Znacznik kładziemy na wygładzonej linii; tooltip pokazuje surowe dane.
        const point = this._displayPoints(chart, series, payload).find(p => p.time === this._cursorTime && Number.isFinite(p.value));
        if (point) {
          ctx.beginPath(); ctx.fillStyle = series.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
          ctx.arc(cx, y(point.value, series.axis), 4.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    }
    // Gesture selection overlay.
    if (this._gesture?.kind === 'select') {
      const a = Math.min(this._gesture.startX, this._gesture.currentX), b = Math.max(this._gesture.startX, this._gesture.currentX);
      ctx.fillStyle = 'rgba(78,166,224,.17)'; ctx.fillRect(a, plot.top, b - a, plot.height);
      ctx.strokeStyle = 'rgba(105,190,244,.8)'; ctx.strokeRect(a, plot.top, b - a, plot.height);
    }
  }

  _drawEmpty(ctx, width, height, text) {
    ctx.fillStyle = 'rgba(185,202,213,.72)'; ctx.font = '13px Roboto, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, width / 2, height / 2);
  }

  _formatTick(value) {
    if (!Number.isFinite(value)) return '—';
    return Number(value).toLocaleString('pl-PL', { maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0 });
  }

  _zoomAt(ratio, factor) {
    const payload = this._currentData;
    if (!payload) return;
    const base = this._viewport || { start: payload.bounds.start.getTime(), end: payload.bounds.end.getTime() };
    const duration = base.end - base.start;
    const nextDuration = Math.max(60000, Math.min(payload.bounds.end.getTime() - payload.bounds.start.getTime(), duration * factor));
    const anchor = base.start + duration * Math.min(1, Math.max(0, ratio));
    let start = anchor - nextDuration * ratio, end = start + nextDuration;
    const fullStart = payload.bounds.start.getTime(), fullEnd = payload.bounds.end.getTime();
    if (start < fullStart) { end += fullStart - start; start = fullStart; }
    if (end > fullEnd) { start -= end - fullEnd; end = fullEnd; }
    this._viewport = { start: Math.max(fullStart, start), end: Math.min(fullEnd, end) };
    this._draw();
  }

  _pointerPosition(event) {
    const rect = event.target.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  _pointerDown(event) {
    if (!this._currentData || !this._plot) return;
    event.preventDefault();
    const p = this._pointerPosition(event);
    if (p.x < this._plot.left || p.x > this._plot.right) return;
    try { event.target.setPointerCapture(event.pointerId); } catch (_) {}
    this._pointers.set(event.pointerId, { ...p, type: event.pointerType });
    if (event.pointerType === 'touch') {
      if (this._pointers.size === 1) {
        const base = this._viewport || { start: this._currentData.bounds.start.getTime(), end: this._currentData.bounds.end.getTime() };
        this._gesture = { kind: 'touch-pan', startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: false, base: { ...base } };
      } else if (this._pointers.size === 2) {
        const pts = [...this._pointers.values()];
        const center = (pts[0].x + pts[1].x) / 2;
        const distance = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        const base = this._viewport || { start: this._currentData.bounds.start.getTime(), end: this._currentData.bounds.end.getTime() };
        const duration = base.end - base.start;
        this._gesture = { kind: 'pinch', distance, center, base: { ...base }, anchor: base.start + duration * ((center - this._plot.left) / this._plot.width) };
      }
    } else if (event.pointerType === 'mouse' && event.button === 0) {
      this._gesture = { kind: 'select', startX: p.x, currentX: p.x, base: this._viewport || { start: this._currentData.bounds.start.getTime(), end: this._currentData.bounds.end.getTime() } };
    }
  }

  _pointerMove(event) {
    const p = this._pointerPosition(event);
    if (!this._pointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse' && !this._gesture) this._showTooltip(p.x, p.y);
      return;
    }
    this._pointers.set(event.pointerId, { ...p, type: event.pointerType });
    if (this._gesture?.kind === 'touch-pan' && this._pointers.size === 1) {
      const dx = p.x - this._gesture.lastX;
      if (Math.abs(p.x - this._gesture.startX) > 8 || Math.abs(p.y - this._gesture.startY) > 8) this._gesture.moved = true;
      this._gesture.lastX = p.x; this._gesture.lastY = p.y;
      if (this._gesture.moved) {
        const span = this._gesture.base.end - this._gesture.base.start;
        const shift = -dx / this._plot.width * span;
        this._setViewportClamped(this._gesture.base.start + shift, this._gesture.base.end + shift);
        this._gesture.base = { ...this._viewport }; this._draw();
      }
    } else if (this._gesture?.kind === 'pinch' && this._pointers.size >= 2) {
      const pts = [...this._pointers.values()].slice(0, 2);
      const center = (pts[0].x + pts[1].x) / 2;
      const distance = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
      const scale = distance / this._gesture.distance;
      const baseDuration = this._gesture.base.end - this._gesture.base.start;
      const duration = Math.max(60000, Math.min(this._currentData.bounds.end.getTime() - this._currentData.bounds.start.getTime(), baseDuration / scale));
      const centerShift = (center - this._gesture.center) / this._plot.width * baseDuration;
      const centerTime = this._gesture.anchor + centerShift;
      const anchorRatio = (this._gesture.anchor - this._gesture.base.start) / baseDuration;
      const start = centerTime - duration * anchorRatio;
      this._setViewportClamped(start, start + duration);
      this._draw();
    } else if (this._gesture?.kind === 'select' && this._pointers.size === 1) {
      this._gesture.currentX = p.x; this._draw();
    }
  }

  _pointerUp(event) {
    if (!this._pointers.has(event.pointerId)) return;
    const oldGesture = this._gesture;
    const released = this._pointers.get(event.pointerId);
    this._pointers.delete(event.pointerId);
    if (oldGesture?.kind === 'select') {
      const a = Math.min(oldGesture.startX, oldGesture.currentX), b = Math.max(oldGesture.startX, oldGesture.currentX);
      if (b - a > 25 && this._plot && this._currentData) {
        const base = oldGesture.base, duration = base.end - base.start;
        const start = base.start + ((a - this._plot.left) / this._plot.width) * duration;
        const end = base.start + ((b - this._plot.left) / this._plot.width) * duration;
        this._setViewportClamped(start, end);
      }
    }
    if (oldGesture?.kind === 'touch-pan' && released && !oldGesture.moved && this._pointers.size === 0) this._showTooltip(released.x, released.y);
    if (this._pointers.size === 0) this._gesture = null;
    else if ([...this._pointers.values()].some(p => p.type === 'touch')) {
      const remaining = [...this._pointers.values()][0];
      const base = this._viewport || { start: this._currentData.bounds.start.getTime(), end: this._currentData.bounds.end.getTime() };
      this._gesture = { kind: 'touch-pan', startX: remaining.x, lastX: remaining.x, base: { ...base } };
    }
    if (!(oldGesture?.kind === 'touch-pan' && released && !oldGesture.moved)) this._hideTooltip();
    this._draw();
  }

  _setViewportClamped(start, end) {
    const fullStart = this._currentData.bounds.start.getTime(), fullEnd = this._currentData.bounds.end.getTime();
    let duration = Math.min(fullEnd - fullStart, Math.max(60000, end - start));
    start = Math.max(fullStart, Math.min(start, fullEnd - duration));
    end = start + duration;
    this._viewport = { start, end };
  }

  _showTooltip(px, py) {
    if (!this._currentData || !this._plot || px < this._plot.left || px > this._plot.right || py < this._plot.top || py > this._plot.bottom) { this._hideTooltip(); return; }
    const canvas = this.shadowRoot.querySelector('canvas');
    const tooltip = this.shadowRoot.querySelector('.tooltip');
    const chart = this._activeChart();
    const payload = this._currentData;
    const domain = this._viewport || { start: payload.bounds.start.getTime(), end: payload.bounds.end.getTime() };
    const hoveredTime = domain.start + ((px - this._plot.left) / this._plot.width) * (domain.end - domain.start);
    // Pick the closest *available chart sample*, not the hovered wall-clock
    // time. The tolerance is restricted to ~half a sample, with a small
    // allowance for mouse/touch pixel precision when zoomed out.
    const latest = Math.min(payload.sampledUntil ?? -Infinity, Date.now());
    const visibleLines = chart.series.filter(series => series.type !== 'area' && !this._visible.has(series.entity));
    const candidateTimes = new Set();
    for (const series of visibleLines) {
      for (const point of payload.data.get(series.entity) || []) {
        if (Number.isFinite(point.value) && point.time <= latest && point.time >= domain.start && point.time <= domain.end) {
          candidateTimes.add(point.time);
        }
      }
    }
    let time = null;
    let bestDistance = Infinity;
    for (const candidate of candidateTimes) {
      const distance = Math.abs(candidate - hoveredTime);
      if (distance < bestDistance) { bestDistance = distance; time = candidate; }
    }
    const msPerPixel = (domain.end - domain.start) / Math.max(1, this._plot.width);
    const tolerance = Math.max(payload.bucketMs * 0.51, msPerPixel * 2);
    if (time == null || bestDistance > tolerance) { this._hideTooltip(); return; }
    const lines = [];
    for (const series of chart.series) {
      if (this._visible.has(series.entity)) continue;
      const points = payload.data.get(series.entity) || [];
      if (series.type !== 'area') {
        const sample = points.find(point => point.time === time && Number.isFinite(point.value));
        if (sample) lines.push({ series, point: sample });
      } else {
        const active = points.find(point => point.start <= time && point.end > time);
        lines.push({ series, point: active || { value: 0 }, state: true });
      }
    }
    if (!lines.some(item => !item.state)) { this._hideTooltip(); return; }
    tooltip.replaceChildren();
    const heading = document.createElement('div'); heading.className = 'tooltip-time'; heading.textContent = new Date(time).toLocaleString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); tooltip.append(heading);
    // W tooltipie zachowujemy serie pomiarowe przed zaznaczeniami bypass/grzalka.
    const orderedLines = [
      ...lines.filter(item => item.series.type !== 'area'),
      ...lines.filter(item => item.series.type === 'area')
    ];
    for (const item of orderedLines) {
      const row = document.createElement('div'); row.className = 'tip-row';
      const label = document.createElement('span'); label.className = 'tip-name';
      const dot = document.createElement('span'); dot.className = 'tip-dot'; dot.style.background = item.series.color;
      const name = document.createElement('span'); name.textContent = item.series.name; label.append(dot, name);
      const value = document.createElement('strong'); value.textContent = item.state
        ? (item.series.entity === 'sensor.rekuperator_stan_bypassu'
            ? (item.point.value >= 0.5 ? 'Otwarty' : 'Zamknięty')
            : (item.point.value >= 0.5 ? 'Włączony' : 'Wyłączony'))
        : `${Number(item.point.value).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ${item.series.unit}`;
      row.append(label, value); tooltip.append(row);
    }
    this._cursorTime = time;
    this._tooltipAnchor = { x: px, y: py };
    this._draw();
    tooltip.style.display = 'block';
    const gap = 13, pad = 8;
    const tipWidth = tooltip.offsetWidth, tipHeight = tooltip.offsetHeight;
    const chartWidth = canvas.clientWidth, chartHeight = canvas.clientHeight;
    // Choose a side that keeps the tooltip off the touched/clicked point.
    // The fallback above/below is useful on narrow phones with long labels.
    const options = [
      { left: px + gap, top: py - tipHeight / 2 },
      { left: px - tipWidth - gap, top: py - tipHeight / 2 },
      { left: px - tipWidth / 2, top: py + gap },
      { left: px - tipWidth / 2, top: py - tipHeight - gap }
    ];
    const maxLeft = Math.max(pad, chartWidth - tipWidth - pad);
    const maxTop = Math.max(pad, chartHeight - tipHeight - pad);
    let best = null;
    for (const [i, option] of options.entries()) {
      const left = Math.max(pad, Math.min(maxLeft, option.left));
      const top = Math.max(pad, Math.min(maxTop, option.top));
      const clampDistance = Math.abs(left - option.left) + Math.abs(top - option.top);
      const nearPoint = px >= left - 7 && px <= left + tipWidth + 7 && py >= top - 7 && py <= top + tipHeight + 7;
      const score = (nearPoint ? 10000 : 0) + clampDistance * 4 + i * 0.01;
      if (!best || score < best.score) best = { left, top, score };
    }
    tooltip.style.left = `${best.left}px`; tooltip.style.top = `${best.top}px`;
  }

  _hideTooltip() { this._cursorTime = null; this._tooltipAnchor = null; const tooltip = this.shadowRoot.querySelector('.tooltip'); if (tooltip) tooltip.style.display = 'none'; this._draw(); }
}

if (!customElements.get('req-rekuperator-charts')) customElements.define('req-rekuperator-charts', RekuperatorCharts);

window.customCards = window.customCards || [];
window.customCards.push({ type: 'req-rekuperator-charts', name: 'Rekuperator reQ — wykresy', description: 'Wykresy Canvas z historii Home Assistant Recorder', preview: false });

})();
