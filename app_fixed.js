/* Black Vial Society — app.js (vanilla) */

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ---------- Utilities ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money = n => `$${Number(n).toFixed(2)}`;
const num = n => Number(n).toFixed(2);

function parseAmount(str){
  // "10 mg" or "5000 IU" -> {amount:10, unit:"mg"}
  const m = String(str).trim().match(/([\d.]+)\s*([a-zA-Zµμ]+)/);
  if(!m) return {amount: NaN, unit: ""};
  let unit = m[2].toLowerCase();
  unit = unit.replace('μ','u').replace('µ','u'); // normalize
  if(unit === 'mcg') unit = 'mcg';
  if(unit === 'iu') unit = 'iu';
  if(unit === 'mg') unit = 'mg';
  return {amount: Number(m[1]), unit};
}

function stockClass(n){
  const v = Number(n)||0;
  if(v<=0) return 'out';
  if(v<=5) return 'low';
  return 'ok';


/* ---------- Kit rules ---------- */
const KIT_MIN_SINGLE = 20;   // kits exist only when singles > 20
const KIT_SIZE = 10;         // kit contains 10 single vials

function isKitLabel(label){
  return /kit\s*x\s*10/i.test(String(label)) || /x\s*10/i.test(String(label)) && /kit/i.test(String(label));
}

function fmtAmountUnit(amount, unit){
  const a = (Number.isFinite(amount) ? amount : NaN);
  const cleanA = Number.isFinite(a) ? (Number.isInteger(a) ? String(a) : String(a)) : '';
  const u = (unit||'').toLowerCase()==='iu' ? 'IU' : 'mg';
  return `${cleanA}${u}`;
}

function makeKitLabel(singleLabel){
  const p = parseAmount(singleLabel);
  if(!Number.isFinite(p.amount)) return null;
  return `${fmtAmountUnit(p.amount, p.unit)} kit x10`;
}

function kitStockFromSingle(singleStock){
  const s = Number(singleStock)||0;
  if(s <= KIT_MIN_SINGLE) return 0;
  return Math.floor((s - KIT_MIN_SINGLE) / KIT_SIZE);
}
}

/* ---------- Classic math with unit handling ---------- */
function classicCalc({amountPerVial, vialUnit='mg', diluentMl, desired, desiredUnit='mg', syringeScale=100}) {
  const amt   = Number(amountPerVial)||0;
  const mlD   = Number(diluentMl)||0;
  const want  = Number(desired)||0;
  const scale = Number(syringeScale)||100;

  const vUnit = String(vialUnit||'mg').toLowerCase();
  const dUnit = String(desiredUnit||'mg').toLowerCase();

  let desiredInVial = NaN;
  let note = '';

  if (vUnit === 'mg') {
    if (dUnit === 'mg') desiredInVial = want;
    else if (dUnit === 'mcg') desiredInVial = want/1000;
    else if (dUnit === 'iu') note = 'Unit mismatch: this vial is in mg, but desired dose is in IU. mg ↔ IU conversion is not possible without a product-specific factor.';
    else note = 'Unsupported desired dose unit.';
  } else if (vUnit === 'iu') {
    if (dUnit === 'iu') desiredInVial = want;
    else if (dUnit === 'mg' || dUnit === 'mcg') note = 'Unit mismatch: this vial is in IU, but desired dose is in mg/mcg. mg ↔ IU conversion is not possible without a product-specific factor.';
    else note = 'Unsupported desired dose unit.';
  } else {
    note = 'Unsupported vial unit.';
  }

  // concentration in "vial units" (mg or IU) per mL
  const perMl = (amt>0 && mlD>0) ? (amt/mlD) : NaN;

  // insulin syringe assumption: 1 unit = 0.01 mL
  const vialUnitsPerUnit = isFinite(perMl) ? (perMl * 0.01) : NaN;

  // syringe units to pull
  const syringeUnits = (isFinite(vialUnitsPerUnit) && isFinite(desiredInVial) && desiredInVial>=0)
    ? (desiredInVial / vialUnitsPerUnit)
    : NaN;

  const pct = (isFinite(syringeUnits) && scale>0)
    ? Math.max(0, Math.min(100, (syringeUnits/scale)*100))
    : 0;

  return { vialUnit:vUnit, desiredUnit:dUnit, vialUnitsPerUnit, units:syringeUnits, unitsPct:pct, syringeScale:scale, note };
}

/* ---------- Persistence ---------- */
const store = {
  get(key, fallback){
    try{
      const v = localStorage.getItem(key);
      return v==null ? fallback : JSON.parse(v);
    }catch{ return fallback; }
  },
  set(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
  }
};

/* ---------- State ---------- */
let DATA = null;
let GUIDE = [];
let PRICES_RAW = [];

let activeTab = store.get('bvs.tab', 'guide');
let guideFilter = store.get('bvs.guideFilter', 'all');
let hideOosGuide = store.get('bvs.hideOosGuide', false);
let hideOosPrices = store.get('bvs.hideOosPrices', false);
let guideExpanded = store.get('bvs.guideExpanded', false);

let sortKey = store.get('bvs.priceSortKey', 'name');
let sortDir = store.get('bvs.priceSortDir', 'asc');

// Price inflation (hard-coded like original)
const PRICE_MULTIPLIER = 4.29;

const NO_INCREASE = new Set([
  "bacteriostatic water",
  "hospira bacteriostatic water",
  "acetic acid",
  "bac water",
  "hospira bac water",
  "lemon bottle",
  "easytouch 31 gauge 1ml 5/16\" 8mm"
]);

function roundSmart(n){
  const step = n <= 100 ? 5 : 10;
  const lower = Math.floor(n / step) * step;
  const upper = Math.ceil(n / step) * step;
  if (n - lower <= 1.5) return lower;
  return upper;
}

/* ---------- Tabs (ARIA + keyboard) ---------- */
function setTab(tab){
  activeTab = tab;
  store.set('bvs.tab', tab);

  const isGuide = tab === 'guide';
  const guideBtn = $('#tab-guide');
  const pricesBtn = $('#tab-prices');

  guideBtn.classList.toggle('active', isGuide);
  pricesBtn.classList.toggle('active', !isGuide);

  guideBtn.setAttribute('aria-selected', String(isGuide));
  pricesBtn.setAttribute('aria-selected', String(!isGuide));

  $('#panel-guide').classList.toggle('active', isGuide);
  $('#panel-prices').classList.toggle('active', !isGuide);

  // Keep focus within the newly active panel for keyboard users
  (isGuide ? $('#panel-guide') : $('#panel-prices')).focus({preventScroll:true});
}

function wireTabs(){
  const tabs = [$('#tab-guide'), $('#tab-prices')];
  tabs.forEach(btn=>{
    btn.addEventListener('click', ()=> setTab(btn.dataset.tab));
    btn.addEventListener('keydown', (e)=>{
      const i = tabs.indexOf(btn);
      if(e.key === 'ArrowRight'){ e.preventDefault(); tabs[(i+1)%tabs.length].focus(); }
      if(e.key === 'ArrowLeft'){ e.preventDefault(); tabs[(i-1+tabs.length)%tabs.length].focus(); }
      if(e.key === 'Home'){ e.preventDefault(); tabs[0].focus(); }
      if(e.key === 'End'){ e.preventDefault(); tabs[tabs.length-1].focus(); }
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); btn.click(); }
    });
  });
}

/* ---------- Guide rendering ---------- */
function guidePasses(item, q){
  const query = q.trim().toLowerCase();
  const inText = (item.name + ' ' + item.short + ' ' + (item.badge||'') + ' ' + (item.category||'')).toLowerCase();
  const passQ = !query || inText.includes(query);
  const passFilter = guideFilter === 'all' || item.category === guideFilter;

  let inStock = false;
  if(item.stock && typeof item.stock === 'object'){
    inStock = Object.values(item.stock).some(v => Number(v)>0);
  }
  const passOOS = !hideOosGuide || inStock;

  return passQ && passFilter && passOOS;
}

function renderGuide(){
  const q = $('#q').value || '';
  const grid = $('#grid');
  grid.innerHTML = '';

  const filtered = (GUIDE||[]).filter(item => guidePasses(item, q));
  $('#empty').style.display = filtered.length ? 'none' : 'block';
  $('#gstatus').textContent = filtered.length ? `Showing ${filtered.length} item${filtered.length===1?'':'s'}.` : '';

  for(const item of filtered){
    // Singles first, then derived kits (x10) after singles
    const singles = (item.doses||[]).filter(d => !isKitLabel(d));
    const existingKits = (item.doses||[]).filter(d => isKitLabel(d));
    const existingKitSet = new Set(existingKits.map(d => String(d)));

    const derivedKits = [];
    for(const sLabel of singles){
      const kLabel = makeKitLabel(sLabel);
      if(!kLabel) continue;
      const sStock = (item.stock && item.stock[sLabel] != null) ? Number(item.stock[sLabel]) : 0;
      // kits show if they used to exist OR singles are above the threshold
      if(existingKitSet.has(kLabel) || sStock > KIT_MIN_SINGLE){
        derivedKits.push(kLabel);
      }
    }

    const doseLabels = [...singles, ...derivedKits];

    const dosesHtml = doseLabels.map(label=>{
      const isKit = isKitLabel(label);
      let stock = null;

      if(isKit){
        // Derive kit stock from matching single label (same amount/unit)
        const {amount, unit} = parseAmount(label);
        const unitText = (unit||'').toLowerCase()==='iu' ? 'IU' : 'mg';
        const matchSingle = singles.find(s=>{
          const p = parseAmount(s);
          if(!Number.isFinite(p.amount)) return false;
          const su = (p.unit||'').toLowerCase()==='iu' ? 'IU' : 'mg';
          return Math.abs(p.amount-amount)<1e-9 && su===unitText;
        });
        const sStock = matchSingle && item.stock && item.stock[matchSingle]!=null ? Number(item.stock[matchSingle]) : 0;
        stock = kitStockFromSingle(sStock);
      }else{
        stock = (item.stock && item.stock[label] != null) ? Number(item.stock[label]) : null;
      }

      const out = stock!=null && stock<=0;
      const cls = stockClass(stock);
      const stockText = stock==null ? '' : (out ? 'Out of stock' : `${stock} in stock`);
      const aria = out ? 'aria-disabled="true"' : '';
      const dis = out ? 'disabled' : '';
      const kind = isKit ? 'kit' : 'single';

      return `<button class="dose ${cls}" data-dose="${esc(label)}" data-kind="${kind}" ${dis} ${aria}>
        <span class="dose-amt">${esc(label)}</span>
        <span class="dose-stock">${esc(stockText)}</span>
      </button>`;
    }).join('');

    const badge = item.badge ? `<span class="badge">${esc(item.badge)}</span>` : '';
    const more = item.more ? `<div class="desc">${esc(item.more)}</div>` : `<div class="desc">—</div>`;
    const fact = item.fact ? `<div class="fact">${esc(item.fact)}</div>` : '';
    const onset = item.onset ? `<div class="onset">${esc(item.onset)}</div>` : '';

    const html = `
      <article class="card" data-key="${esc(item.key||item.name)}">
        <div class="card-top">
          <h3 class="title">${esc(item.name||'')}</h3>
          ${badge}
        </div>

        <div class="desc">${esc(item.short||'')}</div>
        ${onset}
        ${fact}

        <div class="dose-label">Available sizes:</div>
        <div class="doses">${dosesHtml}</div>

        <div class="mini-wrap" style="display:none" data-mini="${esc(item.key||item.name)}">${miniTemplate().replaceAll('__CARD__', esc(item.key||item.name))}</div>

        <details class="more">
          <summary class="more-summary">More info</summary>
          ${more}
        </details>
      </article>
    `;
    grid.insertAdjacentHTML('beforeend', html);
  }

  wireDoseButtons();
}

function setGuideFilter(filter){
  guideFilter = filter;
  store.set('bvs.guideFilter', filter);
  $$('.toolbar [data-filter]').forEach(btn=>{
    const is = btn.dataset.filter === filter;
    btn.classList.toggle('active', is);
    btn.setAttribute('aria-pressed', String(is));
  });
  renderGuide();
}

function setHideOosGuide(v){
  hideOosGuide = !!v;
  store.set('bvs.hideOosGuide', hideOosGuide);
  const btn = $('#toggleOOS');
  btn.setAttribute('aria-pressed', String(hideOosGuide));
  btn.textContent = hideOosGuide ? 'Show out-of-stock' : 'Hide out-of-stock';
  renderGuide();
}

function setGuideExpanded(v){
  guideExpanded = !!v;
  store.set('bvs.guideExpanded', guideExpanded);
  $$('details.more').forEach(d => d.open = guideExpanded);
}

/* ---------- Mini calculator wiring ---------- */
function ensureTicks(ticksEl, scale){
  ticksEl.innerHTML = '';
  // 0..scale, major each 10 (or 5 when scale=30)
  const majorStep = (scale === 30) ? 5 : 10;
  for(let i=0;i<=scale;i++){
    const isMajor = i % majorStep === 0;
    const tick = document.createElement('div');
    tick.className = `tick ${isMajor?'major':'minor'}`;
    tick.style.height = isMajor ? '14px' : '8px';
    tick.style.background = '#3a3d47';
    if(isMajor){
      const n = document.createElement('div');
      n.className = 'n';
      n.textContent = String(i);
      tick.appendChild(n);
    }
    ticksEl.appendChild(tick);
  }
}


function miniTemplate(){
  return `
    <div class="mini">
      <div class="mini-head">
        <div>
          <div class="mini-title">Peptide calculator</div>
          <div class="mini-sub"><span data-out="doseLabel">—</span> <span class="dot">•</span> <span data-out="doseStock">—</span></div>
        </div>
        <button class="chip" type="button" data-close-mini="__CARD__">Close</button>
      </div>

      <div class="mini-body">
        <div class="mini-grid3">
          <div class="field">
            <label>Peptide per vial</label>
            <input data-role="amountPerVial" inputmode="decimal" value="0"/>
          </div>

          <div class="field">
            <label>&nbsp;</label>
            <select data-role="vialUnit">
              <option value="mg">mg</option>
              <option value="iu">IU</option>
            </select>
          </div>

          <div class="field">
            <label>Diluent added (mL)</label>
            <input data-role="diluentMl" inputmode="decimal" value="1"/>
          </div>

          <div class="field">
            <label>Desired dose</label>
            <input data-role="desired" inputmode="decimal" value="0"/>
          </div>

          <div class="field">
            <label>&nbsp;</label>
            <select data-role="desiredUnit">
              <option value="iu">IU</option>
              <option value="mcg">mcg</option>
              <option value="mg">mg</option>
            </select>
          </div>

          <div class="field">
            <label>Syringe scale</label>
            <select data-role="syringeScale">
              <option value="100">U-100</option>
              <option value="50">U-50</option>
              <option value="30">U-30</option>
              <option value="10">U-10</option>
            </select>
          </div>
        </div>

        <div class="classic" style="margin-top:12px">
          <div class="bar">
            <div class="fill"></div>
            <div class="cursor"></div>
          </div>
          <div class="ticks"></div>

          <div class="mini-stats">
            <div class="stat"><b>Units to pull</b><span data-out="units">—</span></div>
            <div class="stat"><b>Potency</b><span data-out="vpu">—</span></div>
          </div>

          <div class="warn" data-out="note" style="display:none"></div>
        </div>
      </div>
    </div>
  `;
}
function openMini(card, doseLabel, anchorBtn=null){
  let mini = card.querySelector('.mini-wrap');
  if(!mini){
    mini = document.createElement('div');
    mini.className = 'mini-wrap';
    mini.dataset.mini = card.dataset.key || '';
    // inject template
    const key = card.dataset.key || '';
    mini.innerHTML = miniTemplate().replaceAll('__CARD__', esc(key));
    card.appendChild(mini);
  }

  // Move calculator directly under the clicked dose chip
  if(anchorBtn && anchorBtn.insertAdjacentElement){
    anchorBtn.insertAdjacentElement('afterend', mini);
  }

  // Populate header line
  const stockText = (anchorBtn && anchorBtn.querySelector('.dose-stock')) ? anchorBtn.querySelector('.dose-stock').textContent.trim() : '';
  const doseLabelEl = mini.querySelector('[data-out="doseLabel"]');
  const doseStockEl = mini.querySelector('[data-out="doseStock"]');
  if(doseLabelEl) doseLabelEl.textContent = doseLabel || '—';
  if(doseStockEl) doseStockEl.textContent = stockText || '—';

  // Populate vial amount/unit from clicked dose label
  const {amount, unit} = parseAmount(doseLabel);
  const amountInput = mini.querySelector('[data-role="amountPerVial"]');
  const vialUnitSel = mini.querySelector('[data-role="vialUnit"]');
  const diluentInput = mini.querySelector('[data-role="diluentMl"]');
  const desiredInput = mini.querySelector('[data-role="desired"]');
  const desiredUnitSel = mini.querySelector('[data-role="desiredUnit"]');

  if(Number.isFinite(amount)) amountInput.value = String(amount);
  // Autofill requested defaults:
  diluentInput.value = '1';
  desiredInput.value = '0';

  const vu = (unit||'').toLowerCase()==='iu' ? 'iu' : 'mg';
  vialUnitSel.value = vu;
  // Default desired unit to mg unless they pick otherwise; match vial unit when IU
  desiredUnitSel.value = (vu==='iu') ? 'iu' : 'mg';

  mini.style.display = 'block';
  updateMini(mini);
}

function closeMini(mini){
  mini.style.display = 'none';
}

function updateMini(mini){
  const amountPerVial = Number(mini.querySelector('[data-role="amountPerVial"]').value||0);
  const diluentMl = Number(mini.querySelector('[data-role="diluentMl"]').value||0);
  const desired = Number(mini.querySelector('[data-role="desired"]').value||0);
  const desiredUnit = mini.querySelector('[data-role="desiredUnit"]').value;
  const syringeScale = Number(mini.querySelector('[data-role="syringeScale"]').value||100);
  const vialUnit = (mini.querySelector('[data-role="vialUnit"]')?.value) || (mini.dataset.vialUnit || 'mg');
  mini.dataset.vialUnit = vialUnit;

  const res = classicCalc({amountPerVial, vialUnit, diluentMl, desired, desiredUnit, syringeScale});

  const unitsEl = mini.querySelector('[data-out="units"]');
  const vpuEl = mini.querySelector('[data-out="vpu"]');
  const noteEl = mini.querySelector('[data-out="note"]');

  unitsEl.textContent = isFinite(res.units) ? `${num(res.units)} units` : '—';
  vpuEl.textContent = isFinite(res.vialUnitsPerUnit) ? `${num(res.vialUnitsPerUnit)} ${res.vialUnit} / unit` : '—';

  if(res.note){
    noteEl.style.display = 'block';
    noteEl.textContent = res.note;
  }else{
    noteEl.style.display = 'none';
    noteEl.textContent = '';
  }

  // update visual
  const classic = mini.querySelector('.classic');
  const fill = mini.querySelector('.fill');
  const cursor = mini.querySelector('.cursor');
  const ticks = mini.querySelector('.ticks');

  if(isFinite(res.units) && res.units >= 0){
    classic.hidden = false;
    fill.style.width = `${res.unitsPct}%`;
    cursor.style.left = `calc(${res.unitsPct}% - 1px)`;
    ensureTicks(ticks, syringeScale);
  }else{
    classic.hidden = true;
  }
}

/* ---------- Prices ---------- */
function computePrices(){
  // PRICES_RAW rows are: [name, strength, basePrice, unit, stock]
  // We derive/override kit rows based on single-vial stock, and ensure kit RAW price = 3× single RAW price.
  const raw = (PRICES_RAW||[]);
  const byName = new Map();
  for(const row of raw){
    const [name, strength, basePrice, unit, stock] = row;
    const key = String(name);
    if(!byName.has(key)) byName.set(key, []);
    byName.get(key).push([name, strength, basePrice, unit, stock]);
  }

  // Build a quick lookup for single raw prices by (name + strength)
  const singleRawPrice = new Map();
  for(const row of raw){
    const [name, strength, basePrice] = row;
    if(!isKitLabel(strength)){
      singleRawPrice.set(`${name}|||${strength}`, Number(basePrice)||0);
    }
  }

  const derivedRows = [];

  // Start with all NON-kit rows as-is (we will append/override kit rows after)
  for(const row of raw){
    const [name, strength, basePrice, unit, stock] = row;
    if(!isKitLabel(strength)){
      derivedRows.push([name, strength, basePrice, unit, stock]);
    }
  }

  // Add/override kit rows based on GUIDE catalog (so it matches what users see)
  for(const item of (GUIDE||[])){
    const name = item.name;
    const singles = (item.doses||[]).filter(d => !isKitLabel(d));
    for(const sLabel of singles){
      const kLabel = kitLabelFromSingle(sLabel);
      if(!kLabel) continue;

      const sStock = (item.stock && item.stock[sLabel]!=null) ? Number(item.stock[sLabel]) : 0;
      // Keep kits visible if either stock is above threshold OR kit existed in data
      const kitExisted = (item.doses||[]).some(d => String(d) === kLabel);
      if(!(kitExisted || sStock > KIT_MIN_SINGLE)) continue;

      const kStock = kitStockFromSingle(sStock);
      const base = singleRawPrice.get(`${name}|||${sLabel}`);
      if(base == null) continue;

      // unit should match the single row's unit where possible
      const unit = (parseAmount(sLabel).unit||'mg').toLowerCase()==='iu' ? 'IU' : 'mg';

      derivedRows.push([name, kLabel, Number(base)*KIT_PRICE_MULT, unit, kStock]);
    }
  }

  return derivedRows.map(row=>{
    const [name, strength, basePrice, unit, stock] = row;

    const {amount, unit: parsedUnit} = parseAmount(strength);
    const unitNorm = (String(unit||parsedUnit||'').trim() || '').toString();
    const s = Number(stock)||0;

    const base = Number(basePrice)||0;

    // Match original behavior:
    // - Do NOT inflate certain item names
    // - Do NOT inflate units "mL" or "pack"
    const skip = NO_INCREASE.has(String(name).toLowerCase()) || unitNorm === 'mL' || unitNorm === 'pack';

    const inflated = skip ? base : base * PRICE_MULTIPLIER;
    const finalPrice = roundSmart(inflated);

    const amt = isFinite(amount) ? amount : NaN;
    const ppu = (isFinite(amt) && amt>0) ? (finalPrice/amt) : NaN;

    return {
      name,
      strength,
      amount: amt,
      price: finalPrice,
      priceBase: base,
      ppu,
      stock: s,
      unit: unitNorm,
      skipInflation: skip
    };
  });
}


function pricePasses(item, q){
  const query = q.trim().toLowerCase();
  const inText = (item.name + ' ' + item.strength + ' ' + item.unit).toLowerCase();
  const passQ = !query || inText.includes(query);
  const passOOS = !hideOosPrices || item.stock>0;
  return passQ && passOOS;
}

function renderPrices(){
  const q = $('#pq').value || '';
  const tbody = $('#priceTable tbody');
  tbody.innerHTML = '';

  let rows = computePrices().filter(r => pricePasses(r, q));

  rows.sort((a,b)=>{
    const dir = sortDir === 'asc' ? 1 : -1;
    const ak = a[sortKey], bk = b[sortKey];
    if(typeof ak === 'string') return ak.localeCompare(bk) * dir;
    const av = Number(ak), bv = Number(bk);
    if(isNaN(av) && isNaN(bv)) return 0;
    if(isNaN(av)) return 1;
    if(isNaN(bv)) return -1;
    return (av-bv) * dir;
  });

  $('#pempty').style.display = rows.length ? 'none' : 'block';
  $('#pstatus').textContent = rows.length ? `Showing ${rows.length} row${rows.length===1?'':'s'}.` : '';

  for(const r of rows){
    const cls = stockClass(r.stock);
    tbody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${esc(r.name)}</td>
        <td>${esc(r.strength)}</td>
        <td class="num">${isFinite(r.amount)?num(r.amount):'—'}</td>
        <td class="num" title="Raw ${money(r.priceBase)} × ${(r.skipInflation?1:PRICE_MULTIPLIER).toFixed(2)}">${money(r.price)}</td>
        <td class="num">${isFinite(r.ppu)?money(r.ppu):'—'}</td>
        <td class="num"><span class="stock-badge ${cls}">${r.stock}</span></td>
        <td><span class="unit-pill">${esc(r.unit)}</span></td>
      </tr>
    `);
  }

  updateSortUI();
}

function setHideOosPrices(v){
  hideOosPrices = !!v;
  store.set('bvs.hideOosPrices', hideOosPrices);
  const btn = $('#ptoggleOOS');
  btn.setAttribute('aria-pressed', String(hideOosPrices));
  btn.textContent = hideOosPrices ? 'Show out-of-stock' : 'Hide out-of-stock';
  renderPrices();
}

function setSort(key){
  if(sortKey === key){
    sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
  }else{
    sortKey = key;
    sortDir = 'asc';
  }
  store.set('bvs.priceSortKey', sortKey);
  store.set('bvs.priceSortDir', sortDir);
  renderPrices();
}

function updateSortUI(){
  // aria-sort on the active th; arrows
  $$('#priceTable thead th.sort').forEach(th=>{
    const k = th.dataset.sort;
    const arrow = th.querySelector('.arrow');
    if(k === sortKey){
      th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      if(arrow) arrow.textContent = sortDir === 'asc' ? '▲' : '▼';
    }else{
      th.removeAttribute('aria-sort');
      if(arrow) arrow.textContent = '';
    }
  });
}

/* ---------- Wiring ---------- */
async function loadData(){
  const res = await fetch('data.json', {cache:'no-store'});
  if(!res.ok) throw new Error('Failed to load data.json');
  DATA = await res.json();
  GUIDE = DATA.guide || [];
  PRICES_RAW = DATA.prices_raw || [];
  $('#updated').textContent = DATA.updated ? `Updated: ${DATA.updated}` : ''; 
}

function wireGuide(){
  $('#q').addEventListener('input', ()=> renderGuide());

  $$('.toolbar [data-filter]').forEach(btn=>{
    btn.addEventListener('click', ()=> setGuideFilter(btn.dataset.filter));
  });

  $('#toggleOOS').addEventListener('click', ()=> setHideOosGuide(!hideOosGuide));
  $('#expand').addEventListener('click', ()=> { setGuideExpanded(true); });
  $('#collapse').addEventListener('click', ()=> { setGuideExpanded(false); });

  // Delegate dose clicks
  $('#grid').addEventListener('click', (e)=>{
    const doseBtn = e.target.closest('button.dose');
    if(doseBtn){
      const card = doseBtn.closest('.card');
      openMini(card, doseBtn.dataset.dose || '', doseBtn);
      return;
    }
    const closeBtn = e.target.closest('[data-close-mini]');
    if(closeBtn){
      const key = closeBtn.dataset.closeMini;
      const mini = document.querySelector(`.mini-wrap[data-mini="${CSS.escape(key)}"]`);
      if(mini) closeMini(mini);
      return;
    }
  });

  // Delegate mini input changes
  $('#grid').addEventListener('input', (e)=>{
    const mini = e.target.closest('.mini-wrap');
    if(mini) updateMini(mini);
  });
  $('#grid').addEventListener('change', (e)=>{
    const mini = e.target.closest('.mini-wrap');
    if(mini) updateMini(mini);
  });
}

function wirePrices(){
  $('#pq').addEventListener('input', ()=> renderPrices());
  $('#ptoggleOOS').addEventListener('click', ()=> setHideOosPrices(!hideOosPrices)); 

  $$('#priceTable thead th.sort').forEach(th=>{
    th.style.cursor = 'pointer';
    th.addEventListener('click', ()=> setSort(th.dataset.sort));
  });
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', async ()=>{
  wireTabs();

  try{
    await loadData();
  }catch(err){
    console.error(err);
    $('#gstatus').textContent = 'Error loading data.';
    $('#pstatus').textContent = 'Error loading data.';
    return;
  }

  // Restore persisted states
  setTab(activeTab);
  setGuideFilter(guideFilter);
  setHideOosGuide(hideOosGuide);
  setHideOosPrices(hideOosPrices);

  // Expand/collapse state
  setGuideExpanded(guideExpanded);

  wireGuide();
  wirePrices();

  renderGuide();
  renderPrices();
});
