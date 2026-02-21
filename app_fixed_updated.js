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

/* ---------- Dose helpers (kits) ---------- */
const KIT_THRESHOLD = 20;
const KIT_MULTIPLIER_RAW = 3; // kit base price = 3x single-vial RAW base price

function normDoseKey(label){
  return String(label||'').toLowerCase().replace(/\s+/g,'').trim();
}
function isKitLabel(label){
  return /kit\s*x\s*10/i.test(String(label||''));
}
function makeKitLabel(amount, unit){
  // match existing style: "10mg kit x10" (no space between amount+unit)
  const u = String(unit||'mg').toLowerCase() === 'iu' ? 'iu' : 'mg';
  const a = (Number.isInteger(amount) ? String(amount) : String(amount));
  return `${a}${u} kit x10`;
}
function findSingleDoseLabel(item, amount, unit){
  const target = normDoseKey(`${amount}${unit}`);
  const keys = Object.keys(item?.stock||{});
  for(const k of keys){
    if(isKitLabel(k)) continue;
    if(normDoseKey(k) === target) return k;
  }
  const doses = item?.doses || [];
  for(const d of doses){
    if(isKitLabel(d)) continue;
    if(normDoseKey(d) === target) return d;
  }
  return null;
}
function buildDisplayDoses(item){
  const doses = Array.isArray(item?.doses) ? item.doses.slice() : [];
  const stockObj = item?.stock && typeof item.stock === 'object' ? item.stock : {};

  const singles = [];
  const kitsExisting = [];
  for(const d of doses){
    if(isKitLabel(d)) kitsExisting.push(d);
    else singles.push(d);
  }

  singles.sort((a,b)=>{
    const pa = parseAmount(a), pb = parseAmount(b);
    const au = (pa.unit||'').toLowerCase(), bu=(pb.unit||'').toLowerCase();
    const av = isFinite(pa.amount)?pa.amount:1e15;
    const bv = isFinite(pb.amount)?pb.amount:1e15;
    if(au !== bu) return au.localeCompare(bu);
    return av-bv;
  });

  const kitsDynamic = [];
  for(const s of singles){
    const st = stockObj[s];
    if(st == null) continue;
    const stock = Number(st)||0;
    const {amount, unit} = parseAmount(s);
    if(!isFinite(amount) || !unit) continue;
    if(stock > KIT_THRESHOLD){
      kitsDynamic.push(makeKitLabel(amount, unit));
    }
  }

  const kitSet = new Map();
  for(const k of [...kitsExisting, ...kitsDynamic]){
    const {amount, unit} = parseAmount(k);
    const key = `${amount}|${(unit||'').toLowerCase()}`;
    if(!kitSet.has(key)) kitSet.set(key, k);
  }
  const kits = Array.from(kitSet.values());
  kits.sort((a,b)=>{
    const pa=parseAmount(a), pb=parseAmount(b);
    const au=(pa.unit||'').toLowerCase(), bu=(pb.unit||'').toLowerCase();
    const av=isFinite(pa.amount)?pa.amount:1e15;
    const bv=isFinite(pb.amount)?pb.amount:1e15;
    if(au!==bu) return au.localeCompare(bu);
    return av-bv;
  });

  return [...singles, ...kits];
}

function getDisplayStock(item, doseLabel){
  const stockObj = item?.stock && typeof item.stock === 'object' ? item.stock : {};
  const raw = stockObj[doseLabel];
  const isKit = isKitLabel(doseLabel);

  if(!isKit){
    return raw==null ? null : Number(raw)||0;
  }

  const {amount, unit} = parseAmount(doseLabel);
  if(!isFinite(amount) || !unit) return 0;
  const singleLabel = findSingleDoseLabel(item, amount, unit);
  const singleStock = singleLabel ? (Number(stockObj[singleLabel])||0) : 0;
  if(singleStock <= KIT_THRESHOLD) return 0;

  if(raw!=null) return Number(raw)||0;
  return Math.max(1, Math.floor(singleStock/10));
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
let CATALOG_ORDER = new Map();

let activeTab = store.get('bvs.tab', 'guide');
let guideFilter = store.get('bvs.guideFilter', 'all');
let hideOosGuide = store.get('bvs.hideOosGuide', false);
let hideOosPrices = store.get('bvs.hideOosPrices', false);
let guideExpanded = store.get('bvs.guideExpanded', false);

let sortKey = store.get('bvs.priceSortKey', 'catalog');
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
    const detailsOpen = guideExpanded;
    const displayDoses = buildDisplayDoses(item);
    const doses = (displayDoses||[]).map(label=>{
      const stock = getDisplayStock(item, label);
      const out = stock!=null && stock<=0;
      const cls = stockClass(stock);
      let badge = '';
      if(stock!=null){
        let labelTxt = '';
        if(out) labelTxt = 'Out of stock';
        else if(stock<=5) labelTxt = `${stock} low stock`;
        else labelTxt = `${stock} in stock`;
        badge = `<span class="stock-badge ${cls}">${labelTxt}</span>`;
      }
      return `
        <button class="dose" type="button" data-key="${esc(item.key)}" data-dose="${esc(label)}" ${out?'disabled':''}>
          <span>${esc(label)}</span>
          ${badge}
        </button>
      `;
    }).join('');

    const more = item.more ? item.more : '<ul><li>Educational info only.</li></ul>';

    const html = `
      <article class="card" data-key="${esc(item.key)}">
        <div class="title">
          <h3>${esc(item.name)}</h3>
          <span class="pill">${esc(item.badge||'')}</span>
        </div>
        <div class="desc">${esc(item.short||'')}</div>
        <div class="onset">${esc(item.onset||'')}</div>

        <details ${detailsOpen?'open':''} class="more">
          <summary class="dose-label">Doses &amp; details</summary>

          <div class="dose-label" style="margin-top:10px">${esc(item.fact||'')}</div>
          <div class="doses" style="margin-top:8px">${doses}</div>

          <div class="mini-wrap" data-mini="${esc(item.key)}" aria-label="Mini calculator">
            <div class="mini-head">
              <div>
                Mini Calculator
                <div class="mini-sub">Concentration → syringe units (educational)</div>
              </div>
              <button class="close-mini" type="button" data-close-mini="${esc(item.key)}">Close</button>
            </div>

            <div class="mini-body">
              <div class="mini-grid">
                <div class="mini-field">
                  <label>Vial amount</label>
                  <input type="number" step="any" min="0" data-role="amountPerVial" value="" inputmode="decimal"/>
                </div>
                <div class="mini-field" data-role-wrap="diluent">
                  <label>Diluent (mL)</label>
                  <input type="number" step="any" min="0" data-role="diluentMl" value="2" inputmode="decimal"/>
                </div>

                <div class="mini-field">
                  <label>Desired dose</label>
                  <div class="dose-row">
                    <input type="number" step="any" min="0" class="desired-input" data-role="desired" value="" inputmode="decimal"/>
                    <select data-role="desiredUnit" aria-label="Desired dose unit">
                      <option value="mg">mg</option>
                      <option value="mcg">mcg</option>
                      <option value="iu">IU</option>
                    </select>
                  </div>
                </div>

                <div class="mini-field" data-role-wrap="syringe">
                  <label>Syringe scale</label>
                  <select data-role="syringeScale" aria-label="Syringe scale">
                    <option value="100">100 units (1 mL)</option>
                    <option value="50">50 units (0.5 mL)</option>
                    <option value="30">30 units (0.3 mL)</option>
                  </select>
                </div>
              </div>

              <div class="classic" hidden>
                <div class="tube" aria-hidden="true">
                  <div class="fill"></div>
                  <div class="cursor"></div>
                </div>
                <div class="ticks" aria-hidden="true"></div>
              </div>

              <div class="mini-stats">
                <div class="stat"><b>Syringe units to pull</b><span data-out="units">—</span></div>
                <div class="stat"><b>Vial units per syringe unit</b><span data-out="vpu">—</span></div>
              </div>

              <div class="warn" data-out="note" style="display:none"></div>
            </div>
          </div>

          <div class="desc" style="margin-top:10px">${more}</div>
        </details>
      </article>
    `;
    grid.insertAdjacentHTML('beforeend', html);
  }
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

function openMini(card, doseLabel){
  const mini = card.querySelector('.mini-wrap');
  if(!mini) return;

  // Populate vial amount/unit from clicked dose label if possible
  const {amount, unit} = parseAmount(doseLabel);
  mini.dataset.vialUnit = unit || 'mg';

  const amountInput = mini.querySelector('[data-role="amountPerVial"]');
  const desiredInput = mini.querySelector('[data-role="desired"]');
  const desiredUnitSel = mini.querySelector('[data-role="desiredUnit"]');

  if(isFinite(amount)) amountInput.value = String(amount);
  if(isFinite(amount)) desiredInput.value = String(amount); // default desired to full vial amount; user can change
  if(unit) {
    // set desired unit to match vial unit when it makes sense
    if(unit === 'iu') desiredUnitSel.value = 'iu';
    else desiredUnitSel.value = 'mg';
  }

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
  const vialUnit = mini.dataset.vialUnit || 'mg';

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
  // PRICES_RAW: [name, strength, basePrice, unit, stock]
  // Enhancements:
  // - Hard-coded inflation multiplier (PRICE_MULTIPLIER) applied like original
  // - Auto-kit rows when single-vial stock > KIT_THRESHOLD
  // - Kit RAW base price = KIT_MULTIPLIER_RAW * (single-vial RAW base price)
  // - If single-vial stock <= KIT_THRESHOLD => corresponding kit is forced out-of-stock
  const rows = (PRICES_RAW||[]).slice();

  // Index single-vial RAW base prices + stocks
  const singleKey = (name, strength) => `${String(name)}|${normDoseKey(strength)}`;

  const singleBaseByKey = new Map();
  const singleStockByKey = new Map();
  const kitRowByKey = new Map(); // existing kit rows (for stock preference)

  for(const r of rows){
    const [name, strength, basePrice, unit, stock] = r;
    if(isKitLabel(strength)){
      kitRowByKey.set(singleKey(name, strength), r);
    }else{
      singleBaseByKey.set(singleKey(name, strength), Number(basePrice)||0);
      singleStockByKey.set(singleKey(name, strength), Number(stock)||0);
    }
  }

  // Generate/normalize kit rows
  const outRows = [];
  const seen = new Set();

  function pushRow(name, strength, basePrice, unit, stock){
    const k = `${String(name)}|${normDoseKey(strength)}`;
    if(seen.has(k)) return;
    seen.add(k);
    outRows.push([name, strength, basePrice, unit, stock]);
  }

  // 1) push all single rows first (we'll sort later)
  for(const r of rows){
    const [name, strength, basePrice, unit, stock] = r;
    if(isKitLabel(strength)) continue;
    pushRow(name, strength, basePrice, unit, stock);
  }

  // 2) include existing kit rows, but update their base price + stock rules
  for(const r of rows){
    const [name, strength, basePrice, unit, stock] = r;
    if(!isKitLabel(strength)) continue;

    const {amount, unit: u} = parseAmount(strength);
    const kitLabelNorm = makeKitLabel(amount, u||unit);
    const singleLabelGuessA = `${amount} ${u||unit}`; // e.g. "10 mg"
    const singleLabelGuessB = `${amount}${u||unit}`;  // e.g. "10mg"

    const singleBase = singleBaseByKey.get(singleKey(name, singleLabelGuessA)) ??
                       singleBaseByKey.get(singleKey(name, singleLabelGuessB));

    const singleStock = singleStockByKey.get(singleKey(name, singleLabelGuessA)) ??
                        singleStockByKey.get(singleKey(name, singleLabelGuessB)) ?? 0;

    const kitBase = (singleBase!=null) ? (singleBase * KIT_MULTIPLIER_RAW) : (Number(basePrice)||0);
    const kitStock = (singleStock <= KIT_THRESHOLD) ? 0 : (Number(stock)||0);

    pushRow(name, kitLabelNorm, kitBase, unit, kitStock);
  }

  // 3) auto-generate kits for single-vial rows with stock > threshold
  for(const r of rows){
    const [name, strength, basePrice, unit, stock] = r;
    if(isKitLabel(strength)) continue;
    const s = Number(stock)||0;
    if(s <= KIT_THRESHOLD) continue;

    const {amount, unit: u} = parseAmount(strength);
    if(!isFinite(amount) || !u) continue;

    const kitLabel = makeKitLabel(amount, u);
    // Prefer an existing kit row's stock if present; otherwise infer from single stock
    const existingKit = kitRowByKey.get(singleKey(name, kitLabel));
    const inferredStock = Math.max(1, Math.floor(s/10));
    const kitStock = (s <= KIT_THRESHOLD) ? 0 : (existingKit ? (Number(existingKit[4])||0) : inferredStock);

    pushRow(name, kitLabel, (Number(basePrice)||0) * KIT_MULTIPLIER_RAW, unit, kitStock);
  }

  // Now compute inflated price/ppu etc.
  return outRows.map(row=>{
    const [name, strength, basePrice, unit, stock] = row;

    // Extract amount/unit (for kit, amount represents per-vial amount; total is x10)
    const isKit = isKitLabel(strength);
    const {amount, unit: parsedUnit} = parseAmount(strength);
    const unitNorm = (String(unit||parsedUnit||'').trim() || '').toString();
    const s = Number(stock)||0;
    const base = Number(basePrice)||0;

    const skip = NO_INCREASE.has(String(name).toLowerCase()) || unitNorm === 'mL' || unitNorm === 'pack';

    const inflated = skip ? base : base * PRICE_MULTIPLIER;
    const finalPrice = roundSmart(inflated);

    let amt = isFinite(amount) ? amount : NaN;
    if(isKit && isFinite(amt)) amt = amt * 10; // total amount in the kit
    const ppu = (isFinite(amt) && amt>0) ? (finalPrice/amt) : NaN;

    const catalogIndex = CATALOG_ORDER.has(String(name)) ? CATALOG_ORDER.get(String(name)) : 1e9;

    return {
      name,
      strength,
      amount: amt,
      price: finalPrice,
      priceBase: base,
      ppu,
      stock: s,
      unit: unitNorm,
      skipInflation: skip,
      catalogIndex,
      isKit
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
    // Default = catalog order (Guide order), then by amount, then kits after singles.
    if(sortKey === 'catalog'){
      const ci = (a.catalogIndex ?? 1e9) - (b.catalogIndex ?? 1e9);
      if(ci !== 0) return ci;
      // within a product: singles first, then kits; then amount
      if(!!a.isKit !== !!b.isKit) return a.isKit ? 1 : -1;
      const av = isFinite(a.amount)?a.amount:1e15;
      const bv = isFinite(b.amount)?b.amount:1e15;
      if(av !== bv) return av - bv;
      return String(a.strength).localeCompare(String(b.strength));
    }

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
        <td class="num" title="Raw ${money(r.priceRaw)} × ${PRICE_MULTIPLIER}">${money(r.price)}</td>
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
  if(sortKey === 'catalog'){
    $$('#priceTable thead th.sort').forEach(th=>{
      th.removeAttribute('aria-sort');
      const arrow = th.querySelector('.arrow');
      if(arrow) arrow.textContent = '';
    });
    return;
  }
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
  CATALOG_ORDER = new Map();
  (GUIDE||[]).forEach((g,i)=> CATALOG_ORDER.set(String(g.name), i));
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
      openMini(card, doseBtn.dataset.dose || '');
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

  // Price sheet default ordering = catalog (Guide) order
  const allowedSort = new Set(['catalog','name','strength','amount','price','ppu','stock','unit']);
  if(!allowedSort.has(sortKey)) sortKey = 'catalog';
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
