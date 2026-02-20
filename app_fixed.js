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
    const detailsOpen = guideExpanded;
    const doses = (item.doses||[]).map(label=>{
      const stock = (item.stock && item.stock[label] != null) ? Number(item.stock[label]) : null;
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

        <div class="dose-block">
          <div class="dose-label" style="margin-top:10px">${esc(item.fact||'')}</div>
          <div class="doses" style="margin-top:8px">${doses}</div>
          <div class="mini-parking" data-mini-parking="${esc(item.key)}"></div>
        </div>

        <div class="mini-wrap" data-mini="${esc(item.key)}" aria-label="Mini calculator">
          <div class="mini-head">
            <div>
              <div class="mini-title">Peptide calculator</div>
              <div class="mini-sub" data-role="miniMeta">—</div>
            </div>
            <button class="close-mini" type="button" data-close-mini="${esc(item.key)}">Close</button>
          </div>

          <div class="mini-body">
            <div class="mini-form" role="group" aria-label="Peptide calculator inputs">
              <div class="mini-field field-pep">
                <label>Peptide per vial</label>
                <input type="number" step="any" min="0" data-role="amountPerVial" value="" inputmode="decimal"/>
              </div>
              <div class="mini-field mini-unit field-pepUnit">
                <label class="sr-only">Peptide per vial unit</label>
                <select data-role="vialUnit" aria-label="Peptide per vial unit">
                  <option value="mg">mg</option>
                  <option value="iu">IU</option>
                </select>
              </div>
              <div class="mini-field field-diluent">
                <label>Diluent added (mL)</label>
                <input type="number" step="any" min="0" data-role="diluentMl" value="1" inputmode="decimal"/>
              </div>

              <div class="mini-field field-desired">
                <label>Desired dose</label>
                <input type="number" step="any" min="0" data-role="desired" value="0" inputmode="decimal"/>
              </div>
              <div class="mini-field mini-unit field-desiredUnit">
                <label class="sr-only">Desired dose unit</label>
                <select data-role="desiredUnit" aria-label="Desired dose unit">
                  <option value="iu">IU</option>
                  <option value="mcg">mcg</option>
                  <option value="mg">mg</option>
                </select>
              </div>
              <div class="mini-field field-syringe">
                <label>Syringe scale</label>
                <select data-role="syringeScale" aria-label="Syringe scale">
                  <option value="100">U-100</option>
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

        <details class="moreinfo" ${detailsOpen?'open':''}>
          <summary>More info</summary>
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
  $$('details.moreinfo').forEach(d => d.open = guideExpanded);
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

function closeAllMinis(exceptMini=null){
  $$('.mini-wrap').forEach(mini=>{
    if(exceptMini && mini === exceptMini) return;
    if(mini.style.display === 'none') return;
    closeMini(mini);
  });
}

function openMini(card, btn, doseLabel){
  const mini = card.querySelector('.mini-wrap');
  if(!mini) return;

  // ensure only one mini is open at a time (matches OG behavior)
  closeAllMinis(mini);

  // Move mini directly under the clicked dose button (inline under that chip)
  const dosesWrap = card.querySelector('.doses');
  if(dosesWrap && btn){
    dosesWrap.insertBefore(mini, btn.nextSibling);
  }

  // Populate vial amount/unit from clicked dose label
  const {amount, unit} = parseAmount(doseLabel);
  mini.dataset.vialUnit = unit || 'mg';

  const amountInput = mini.querySelector('[data-role="amountPerVial"]');
  const vialUnitSel = mini.querySelector('[data-role="vialUnit"]');
  const diluentInput = mini.querySelector('[data-role="diluentMl"]');
  const desiredInput = mini.querySelector('[data-role="desired"]');
  const desiredUnitSel = mini.querySelector('[data-role="desiredUnit"]');

  const metaEl = mini.querySelector('[data-role="miniMeta"]');
  if(metaEl){
    const stockTxt = btn?.querySelector('.stock')?.textContent?.trim();
    const doseTxt = (doseLabel||'').trim() || btn?.textContent?.trim() || '';
    metaEl.textContent = stockTxt ? `${doseTxt} • ${stockTxt}` : (doseTxt || '');
  }


  if(isFinite(amount)) amountInput.value = String(amount);
  if(vialUnitSel){ vialUnitSel.value = (unit === 'iu') ? 'iu' : 'mg'; }
  // Autofill per your request
  diluentInput.value = '1';
  desiredInput.value = '0';

  if(unit) {
    // Default desired unit to match vial unit when possible
    if(unit === 'iu') desiredUnitSel.value = 'iu';
    else desiredUnitSel.value = 'mg';
  }

  mini.style.display = 'block';
  updateMini(mini);
}

function closeMini(mini){
  mini.style.display = 'none';
  // Park it back under the dose block so layout stays consistent
  const key = mini.getAttribute('data-mini');
  const parking = key ? document.querySelector(`[data-mini-parking="${CSS.escape(key)}"]`) : null;
  if(parking) parking.appendChild(mini);
}

function updateMini(mini){
  const amountPerVial = Number(mini.querySelector('[data-role="amountPerVial"]').value||0);
  const diluentMl = Number(mini.querySelector('[data-role="diluentMl"]').value||0);
  const desired = Number(mini.querySelector('[data-role="desired"]').value||0);
  const desiredUnit = mini.querySelector('[data-role="desiredUnit"]').value;
  const syringeScale = Number(mini.querySelector('[data-role="syringeScale"]').value||100);
  const vialUnit = (mini.querySelector('[data-role="vialUnit"]')?.value || mini.dataset.vialUnit || 'mg');

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
  return (PRICES_RAW||[]).map(row=>{
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
        <td class="num" title="Raw ${money(r.priceBase)} × ${PRICE_MULTIPLIER}">${money(r.price)}</td>
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
      openMini(card, doseBtn, doseBtn.dataset.dose || doseBtn.textContent || '');
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
