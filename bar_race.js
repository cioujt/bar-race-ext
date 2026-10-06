'use strict';
// Bar Chart Race — Tableau dashboard extension (network-enabled, self-hosted).
// Reads a worksheet's summary data (period / id / name / value / optional rank) and animates it.

const $ = (id) => document.getElementById(id);
const DEFAULT_CFG = { sheet: '', period: '', id: '', name: '', value: '', rank: '', topn: 30, gran: 'all', axis: 'zoom' };
const GUESS = {
  period: /frame|hour|date|time|period/i,
  id: /(^|[^a-z])id($|[^a-z])|player.?id|item/i,
  name: /name|label/i,
  value: /point|score|value|sum|measure/i,
  rank: /rank/i,
};

const S = {
  cfg: { ...DEFAULT_CFG },
  dashboard: null,
  columns: [],        // column names of the current sheet
  table: null,        // last DataTable
  frames: [],         // [{ key, label, rows: [{id, name, value, rank}] }]
  items: new Map(),   // id -> { el, hue }
  idx: 0,
  playing: false,
  timer: null,
  rowH: 18,
  n: 50,
  base: 0,
  top: 1,
};

// ---------- data ----------

async function readSheet(ws) {
  if (ws.getSummaryDataReaderAsync) {
    const reader = await ws.getSummaryDataReaderAsync(10000, { ignoreSelection: true });
    try {
      // getAllPagesAsync throws "0 is invalid value for range: [0..0)" when the sheet has no rows
      // (filter leaves nothing, or the sheet is mid-refresh); the legacy call still returns the columns.
      if (reader.pageCount > 0) return await reader.getAllPagesAsync();
    } finally { await reader.releaseAsync(); }
  }
  return ws.getSummaryDataAsync({ ignoreSelection: true, maxRows: 0 });
}

function toNum(c) {
  const v = c.nativeValue !== undefined && c.nativeValue !== null ? c.nativeValue : c.value;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function periodKey(c) {
  const v = c.nativeValue !== undefined && c.nativeValue !== null ? c.nativeValue : c.value;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v).replace(' ', 'T'));
  return Number.isNaN(t) ? String(v) : t;
}

function dayOf(key) {
  if (typeof key !== 'number') return String(key);
  const d = new Date(key); // Tableau hands over wall-clock values; local getters keep that wall clock
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function guessColumns(cols) {
  const taken = new Set();
  const out = {};
  for (const k of ['rank', 'id', 'name', 'period', 'value']) {
    const hit = cols.find((c) => !taken.has(c) && GUESS[k].test(c));
    out[k] = hit || '';
    if (hit) taken.add(hit);
  }
  return out;
}

function buildFrames(dt, cfg) {
  const ix = (name) => dt.columns.findIndex((c) => c.fieldName === name);
  const ip = ix(cfg.period), ii = ix(cfg.id), iv = ix(cfg.value);
  const inm = cfg.name ? ix(cfg.name) : -1, ir = cfg.rank ? ix(cfg.rank) : -1;
  if (ip < 0 || ii < 0 || iv < 0) return [];

  const byKey = new Map();
  for (const row of dt.data) {
    const key = periodKey(row[ip]);
    let f = byKey.get(key);
    if (!f) { f = { key, label: row[ip].formattedValue || String(key), rows: [] }; byKey.set(key, f); }
    const value = toNum(row[iv]);
    if (Number.isNaN(value)) continue;
    const id = String(row[ii].formattedValue ?? row[ii].value);
    f.rows.push({
      id,
      name: inm >= 0 ? String(row[inm].formattedValue ?? row[inm].value) : id,
      value,
      rank: ir >= 0 ? toNum(row[ir]) : NaN,
    });
  }

  let frames = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (cfg.gran === 'day') {
    const last = new Map();
    for (const f of frames) last.set(dayOf(f.key), f); // sorted ascending → last write = last frame of the day
    frames = [...last.values()];
  }

  const topn = Math.max(1, Number(cfg.topn) || 50);
  for (const f of frames) {
    if (f.rows.some((r) => Number.isNaN(r.rank))) {
      f.rows.sort((a, b) => b.value - a.value);
      f.rows.forEach((r, i) => { r.rank = i + 1; });
    }
    f.rows = f.rows.filter((r) => r.rank <= topn).sort((a, b) => a.rank - b.rank);
  }
  return frames;
}

// ---------- rendering ----------

function colorFor(id) {
  let it = S.items.get(id);
  if (!it) {
    const hue = (S.items.size * 137.508) % 360;
    it = { el: null, hue, name: id };
    S.items.set(id, it);
  }
  return it;
}

function makeRow(id, it) {
  const el = document.createElement('div');
  el.className = 'r out';
  el.innerHTML = '<div class="rk"></div><div class="nm"></div><div class="track"><div class="fill"></div><div class="val"></div></div>';
  el.querySelector('.fill').style.background = `hsl(${it.hue.toFixed(1)}, 58%, 52%)`;
  $('rows').appendChild(el);
  it.el = el;
  return el;
}

function layout() {
  const stageH = $('stage').clientHeight;
  S.n = Math.max(1, ...S.frames.map((f) => f.rows.length));
  S.rowH = Math.max(10, Math.min(36, Math.floor((stageH - 14) / S.n)));
  $('rows').style.height = `${S.n * S.rowH}px`; // font size follows --row-h in CSS
  document.documentElement.style.setProperty('--row-h', `${S.rowH}px`);

  const vals = S.frames.flatMap((f) => f.rows.map((r) => r.value));
  const max = vals.length ? Math.max(...vals) : 1;
  const min = vals.length ? Math.min(...vals) : 0;
  S.top = max;
  S.base = 0;
  if (S.cfg.axis === 'zoom' && min > 0) {
    const step = Math.pow(10, Math.floor(Math.log10(min)));
    S.base = Math.floor(min / step) * step;
    if (S.base >= max) S.base = 0;
  }
}

function render(idx) {
  const f = S.frames[idx];
  if (!f) return;
  S.idx = idx;
  const seen = new Set();
  const span = S.top - S.base || 1;
  for (const r of f.rows) {
    seen.add(r.id);
    const it = colorFor(r.id);
    const el = it.el || makeRow(r.id, it);
    el.classList.remove('out');
    el.style.transform = `translateY(${(r.rank - 1) * S.rowH}px)`;
    const pct = Math.max(0.5, Math.min(90, 90 * (r.value - S.base) / span));
    el.querySelector('.rk').textContent = r.rank;
    el.querySelector('.nm').textContent = r.name;
    el.querySelector('.nm').title = r.name;
    el.querySelector('.fill').style.width = `${pct}%`;
    const val = el.querySelector('.val');
    val.style.left = `${pct}%`;
    val.textContent = r.value.toLocaleString(undefined, { maximumFractionDigits: 1, useGrouping: false });
  }
  for (const [id, it] of S.items) {
    if (!seen.has(id) && it.el) {
      it.el.classList.add('out');
      it.el.style.transform = `translateY(${S.n * S.rowH}px)`;
    }
  }
  $('period-label').textContent = f.label;
  $('scrub').value = idx;
}

function renderNoTransition(idx) {
  const rows = $('rows');
  document.documentElement.style.setProperty('--tick', '0ms');
  render(idx);
  void rows.offsetHeight; // flush so the jump is not animated
  document.documentElement.style.setProperty('--tick', `${tickMs()}ms`);
}

// ---------- playback ----------

const tickMs = () => Number($('speed').value) || 1000;

function setPlaying(on) {
  S.playing = on;
  $('btn-play').textContent = on ? '⏸' : '▶';
  clearTimeout(S.timer);
  if (on) schedule();
}

function schedule() {
  clearTimeout(S.timer);
  S.timer = setTimeout(step, tickMs());
}

function step() {
  if (!S.playing || !S.frames.length) return;
  if (S.idx < S.frames.length - 1) {
    render(S.idx + 1);
    schedule();
  } else if ($('loop').checked) {
    S.timer = setTimeout(() => { renderNoTransition(0); schedule(); }, Math.max(1500, tickMs() * 2));
  } else {
    setPlaying(false);
  }
}

// ---------- settings UI ----------

function fillSelect(sel, options, value, allowEmpty) {
  sel.innerHTML = '';
  if (allowEmpty) sel.appendChild(new Option('(none)', ''));
  for (const o of options) sel.appendChild(new Option(o, o));
  sel.value = options.includes(value) || (allowEmpty && value === '') ? value : (allowEmpty ? '' : options[0] || '');
}

function syncSettingsUI() {
  const c = S.cfg;
  const sheets = S.dashboard ? S.dashboard.worksheets.map((w) => w.name) : ['(mock)'];
  fillSelect($('s-sheet'), sheets, c.sheet, false);
  fillSelect($('s-period'), S.columns, c.period, false);
  fillSelect($('s-id'), S.columns, c.id, false);
  fillSelect($('s-name'), S.columns, c.name, true);
  fillSelect($('s-value'), S.columns, c.value, false);
  fillSelect($('s-rank'), S.columns, c.rank, true);
  $('s-topn').value = c.topn;
  $('s-gran').value = c.gran;
  $('s-axis').value = c.axis;
}

function readSettingsUI() {
  return {
    sheet: $('s-sheet').value, period: $('s-period').value, id: $('s-id').value, name: $('s-name').value,
    value: $('s-value').value, rank: $('s-rank').value, topn: Number($('s-topn').value) || 50,
    gran: $('s-gran').value, axis: $('s-axis').value,
  };
}

function notice(msg) {
  const n = $('notice');
  n.hidden = !msg;
  n.textContent = msg || '';
}

// ---------- load ----------

async function loadData(resetPos) {
  let dt;
  try {
    dt = S.dashboard ? await readSheet(S.dashboard.worksheets.find((w) => w.name === S.cfg.sheet)) : mockTable();
  } catch (e) {
    notice(`Cannot read worksheet "${S.cfg.sheet}": ${e && e.message ? e.message : e}`);
    return;
  }
  S.table = dt;
  if (!dt.columns.length) { rebuild(resetPos); return; } // no columns: keep the field mapping as is
  S.columns = dt.columns.map((c) => c.fieldName);

  const g = guessColumns(S.columns);
  for (const k of ['period', 'id', 'name', 'value', 'rank']) {
    if (!S.columns.includes(S.cfg[k])) S.cfg[k] = g[k];
  }
  syncSettingsUI();
  rebuild(resetPos);
}

function rebuild(resetPos) {
  S.frames = buildFrames(S.table, S.cfg);
  for (const it of S.items.values()) if (it.el) it.el.remove();
  S.items = new Map();
  if (!S.frames.length) {
    notice('No data. Check the worksheet and field mapping (⚙).');
    $('scrub').max = 0;
    $('period-label').textContent = '';
    return;
  }
  notice('');
  layout();
  $('scrub').max = S.frames.length - 1;
  renderNoTransition(resetPos || S.idx >= S.frames.length ? 0 : S.idx);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function watchSheet(ws) {
  const reload = debounce(() => loadData(false), 300);
  const T = tableau.TableauEventType;
  for (const type of [T.FilterChanged, T.SummaryDataChanged, T.MarkSelectionChanged].filter(Boolean)) {
    try { ws.addEventListener(type, reload); } catch (e) { /* event not supported in this version */ }
  }
}

// ---------- mock (open index.html?mock=1 in a browser, no Tableau needed) ----------

function mockTable() {
  const cols = ['event', 'Frame Hour', 'Player Id', 'Player Name', 'Point', 'Rank'].map((n, i) => ({ fieldName: n, index: i }));
  const players = Array.from({ length: 50 }, (_, i) => ({ id: String(2000000000 + i * 7919), name: `Player ${i + 1}`, v: 1500, g: 8 + Math.random() * 18 }));
  const data = [];
  const cell = (v, f) => ({ value: v, nativeValue: v, formattedValue: f !== undefined ? f : String(v) });
  const start = new Date(2026, 8, 3, 0, 0, 0);
  for (let t = 0; t < 107; t++) {
    const d = new Date(start.getTime() + t * 6 * 3600 * 1000);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
    for (const p of players) p.v += Math.max(0, p.g * (0.4 + Math.random()));
    [...players].sort((a, b) => b.v - a.v).forEach((p, i) => {
      data.push([cell('mock'), cell(d, label), cell(p.id), cell(p.name), cell(Math.round(p.v)), cell(i + 1)]);
    });
  }
  return { columns: cols, data };
}

// ---------- init ----------

function loadSavedCfg() {
  try {
    const raw = tableau.extensions.settings.get('cfg');
    if (raw) S.cfg = { ...DEFAULT_CFG, ...JSON.parse(raw) };
  } catch (e) { /* no saved settings */ }
}

async function init() {
  const mock = /[?&]mock/.test(location.search);
  if (!mock && (typeof tableau === 'undefined' || !tableau.extensions)) {
    notice('Tableau Extensions API failed to load (lib/tableau.extensions.1.latest.js).');
    return;
  }
  if (!mock) {
    await tableau.extensions.initializeAsync();
    S.dashboard = tableau.extensions.dashboardContent.dashboard;
    loadSavedCfg();
    const names = S.dashboard.worksheets.map((w) => w.name);
    if (!names.includes(S.cfg.sheet)) S.cfg.sheet = names.find((n) => /race|bar/i.test(n)) || names[0] || '';
    S.dashboard.worksheets.forEach(watchSheet);
  }

  $('btn-play').onclick = () => setPlaying(!S.playing);
  $('btn-restart').onclick = () => { renderNoTransition(0); if (S.playing) schedule(); };
  $('scrub').oninput = (e) => { setPlaying(false); render(Number(e.target.value)); };
  $('speed').onchange = () => { document.documentElement.style.setProperty('--tick', `${tickMs()}ms`); if (S.playing) schedule(); };
  $('btn-gear').onclick = () => { $('settings').hidden = !$('settings').hidden; layout(); if (S.frames.length) renderNoTransition(S.idx); };
  $('s-sheet').onchange = async () => { S.cfg = { ...S.cfg, ...readSettingsUI(), period: '', id: '', name: '', value: '', rank: '' }; await loadData(true); };
  $('s-apply').onclick = async () => {
    S.cfg = { ...S.cfg, ...readSettingsUI() };
    rebuild(true);
    const msg = $('s-msg');
    msg.textContent = '';
    if (!mock) {
      try {
        tableau.extensions.settings.set('cfg', JSON.stringify(S.cfg));
        await tableau.extensions.settings.saveAsync();
        msg.style.color = '#2e7d32';
        msg.textContent = 'Saved';
      } catch (e) {
        msg.style.color = '#b00020';
        msg.textContent = 'Applied here only (settings can be saved in authoring mode)';
      }
    }
  };
  window.addEventListener('resize', debounce(() => { if (S.frames.length) { layout(); renderNoTransition(S.idx); } }, 200));

  document.documentElement.style.setProperty('--tick', `${tickMs()}ms`);
  await loadData(true);
  if (S.frames.length) setPlaying(true);
}

init().catch((e) => notice(`Init failed: ${e && e.message ? e.message : e}`));
