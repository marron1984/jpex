// 描画レイヤ。Chart.js + DOM 操作。

import { AREAS, SLOT_LABELS } from './config.js?v=2026.04.30.9';

// ───── ユーティリティ ──────────────────────────────────────────────

const fmt = {
  yen: (v, digits = 2) => (v == null || !Number.isFinite(v)) ? '—' : `¥${v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`,
  num: (v, digits = 0) => (v == null || !Number.isFinite(v)) ? '—' : v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  gwh: (kwh) => (kwh == null) ? '—' : `${(kwh / 1_000_000).toFixed(2)} GWh`,
  pct: (v) => (v == null) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
  date: (s) => {
    if (!s) return '—';
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}/${m[2]}/${m[3]}` : s;
  },
};

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html != null) e.innerHTML = html;
  return e;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// ───── Chart.js 共通設定 ──────────────────────────────────────────

const CHART_FONT = "'Inter','Noto Sans JP','Hiragino Sans',sans-serif";

const baseChartOptions = () => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      display: true,
      position: 'top',
      align: 'end',
      labels: { color: '#94a3b8', font: { family: CHART_FONT, size: 11 }, boxWidth: 10, boxHeight: 10, usePointStyle: true },
    },
    tooltip: {
      backgroundColor: 'rgba(10,14,26,0.95)',
      borderColor: 'rgba(34,211,238,0.40)',
      borderWidth: 1,
      titleColor: '#7df9ff',
      bodyColor: '#e2e8f0',
      titleFont: { family: CHART_FONT, weight: 'bold' },
      bodyFont: { family: CHART_FONT },
      padding: 10,
      cornerRadius: 8,
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${fmt.yen(ctx.parsed.y, 2)}`,
      },
    },
  },
  scales: {
    x: {
      ticks: { color: '#64748b', font: { family: CHART_FONT, size: 10 }, autoSkip: true, maxRotation: 0 },
      grid: { color: 'rgba(255,255,255,0.04)' },
    },
    y: {
      ticks: {
        color: '#64748b',
        font: { family: CHART_FONT, size: 10 },
        callback: (v) => `¥${v}`,
      },
      grid: { color: 'rgba(255,255,255,0.04)' },
    },
  },
  elements: {
    point: { radius: 0, hoverRadius: 4 },
    line:  { tension: 0.25, borderWidth: 2 },
  },
});

// ───── KPIs ──────────────────────────────────────────────────

const kpiNodes = new Map();   // key -> { node, valueEl, subEl, deltaEl, lastNumeric }

export function renderKpis(metrics) {
  const root = document.getElementById('kpi-row');

  const fYen = (digits = 2) => (v) => fmt.yen(v, digits);

  const cards = [
    { key: 'spot-now',  tone: 'volt',
      label: '直近 システムP',
      numeric: metrics.spotNow,
      formatter: fYen(2),
      sub: metrics.spotNowSlot ? `${SLOT_LABELS[metrics.spotNowSlot - 1]} コマ · ${fmt.date(metrics.spotNowDate)}` : '—',
      delta: metrics.spotNowDelta },
    { key: 'kansai',    tone: 'sun',
      label: '関西エリア',
      numeric: metrics.kansaiNow,
      formatter: fYen(2),
      sub: metrics.kansaiSpread != null ? `vs SYS ${metrics.kansaiSpread > 0 ? '+' : ''}${metrics.kansaiSpread.toFixed(2)}` : '本日 · 直近コマ',
      delta: metrics.kansaiDelta },
    { key: 'avg-today', tone: 'mint',
      label: '本日 平均',
      numeric: metrics.spotAvgToday,
      formatter: fYen(2),
      sub: `H ${fmt.yen(metrics.spotMaxToday)}  /  L ${fmt.yen(metrics.spotMinToday)}` },
    { key: 'intraday',  tone: 'rose',
      label: '時間前 加重平均',
      numeric: metrics.intradayAvg,
      formatter: fYen(2),
      sub: metrics.intradayLatest ? `直近 ${fmt.yen(metrics.intradayLatest)}` : '—',
      delta: metrics.intradayDelta },
    { key: 'volume',    tone: 'violet',
      label: '本日 約定量',
      numeric: metrics.spotVolToday,
      formatter: (v) => fmt.gwh(v),
      sub: '30分コマ合計' },
    { key: 'day-delta', tone: 'slate',
      label: '前日比',
      numeric: metrics.spotDayDelta,
      formatter: (v) => fmt.pct(v),
      sub: metrics.spotAvgYesterday != null ? `昨日 ${fmt.yen(metrics.spotAvgYesterday)}` : '—' },
  ];

  cards.forEach((c, idx) => {
    let entry = kpiNodes.get(c.key);
    if (!entry) {
      const node = el('div', 'kpi entrance');
      node.dataset.tone = c.tone;
      node.style.animationDelay = `${idx * 70}ms`;
      node.innerHTML = `
        <div class="label"></div>
        <div class="value"></div>
        <div class="delta flat"></div>
        <div class="sub"></div>`;
      root.appendChild(node);
      entry = {
        node,
        labelEl: node.querySelector('.label'),
        valueEl: node.querySelector('.value'),
        deltaEl: node.querySelector('.delta'),
        subEl:   node.querySelector('.sub'),
        lastNumeric: null,
      };
      kpiNodes.set(c.key, entry);
    }
    entry.labelEl.textContent = c.label;
    entry.subEl.textContent = c.sub || '';

    // 値: 前回と比較してフラッシュ + カウントアップ
    const prev = entry.lastNumeric;
    const next = c.numeric;
    if (prev != null && next != null && Math.abs(prev - next) > 1e-6) {
      animateValue(entry.valueEl, prev, next, c.formatter);
      entry.node.classList.remove('flash-up', 'flash-down');
      void entry.node.offsetWidth; // restart animation
      entry.node.classList.add(next > prev ? 'flash-up' : 'flash-down');
    } else {
      entry.valueEl.textContent = c.formatter(next);
    }
    entry.lastNumeric = next;

    // delta
    const dCls = c.delta == null ? 'flat' : (c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : 'flat');
    const dArrow = c.delta == null ? '' : (c.delta > 0 ? '▲' : c.delta < 0 ? '▼' : '—');
    entry.deltaEl.className = 'delta ' + dCls;
    entry.deltaEl.textContent = c.delta == null ? '' : `${dArrow} ${fmt.pct(c.delta)}`;
  });
}

// 値を ease-out で滑らかに更新するカウントアップ
function animateValue(el, from, to, formatter, duration = 700) {
  if (el._anim) cancelAnimationFrame(el._anim);
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    const v = from + (to - from) * eased;
    el.textContent = formatter(v);
    if (t < 1) el._anim = requestAnimationFrame(frame);
    else { el.textContent = formatter(to); el._anim = null; }
  }
  el._anim = requestAnimationFrame(frame);
}

// ───── Spot chart ─────────────────────────────────────────────

let spotChart = null;
export function renderSpotChart(records, { range = 'today', activeAreas = ['system', 'tokyo'] } = {}) {
  const canvas = document.getElementById('spot-chart');
  if (!canvas) return;
  if (!records || !records.length) {
    if (spotChart) { spotChart.destroy(); spotChart = null; }
    drawEmptyState(canvas, 'スポットデータなし');
    document.getElementById('spot-meta').textContent = '—';
    return;
  }

  // 日付フィルタ
  const dates = [...new Set(records.map(r => r.date))].sort();
  const today = dates[dates.length - 1];
  const yesterday = dates[dates.length - 2];
  let pickDates;
  if (range === 'yesterday') pickDates = yesterday ? [yesterday] : [today];
  else if (range === 'week') pickDates = dates.slice(-7);
  else pickDates = [today];

  const subset = records.filter(r => pickDates.includes(r.date));

  // X 軸ラベル
  const labels = subset.map(r => {
    const slot = SLOT_LABELS[r.slot - 1] || `#${r.slot}`;
    return pickDates.length === 1 ? slot : `${r.date.slice(5)} ${slot}`;
  });

  // データセット
  const datasets = AREAS
    .filter(a => activeAreas.includes(a.key))
    .map(a => ({
      label: a.label,
      data: subset.map(r => r[a.key]),
      borderColor: a.color,
      backgroundColor: a.color + '22',
      fill: a.key === 'system' && activeAreas.length <= 2,
      borderWidth: a.key === 'system' ? 2.5 : 1.6,
    }));

  document.getElementById('spot-meta').textContent =
    `${pickDates[0]} 〜 ${pickDates[pickDates.length - 1]} · ${subset.length} コマ`;

  if (typeof Chart === 'undefined') {
    drawEmptyState(canvas, 'Chart.js のロードに失敗 (CDN ブロック?)');
    return;
  }
  if (spotChart) spotChart.destroy();
  spotChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: baseChartOptions(),
  });
}

// ───── Area chip toggles ─────────────────────────────────────

export function renderAreaToggles(activeSet, onChange) {
  const root = document.getElementById('spot-area-toggle');
  clear(root);
  for (const a of AREAS) {
    const on = activeSet.has(a.key);
    const chip = el('button', 'area-chip' + (on ? ' on' : ''), a.label);
    if (on) {
      chip.style.backgroundColor = a.color;
      chip.style.borderColor = a.color;
    }
    chip.addEventListener('click', () => {
      if (activeSet.has(a.key)) activeSet.delete(a.key);
      else activeSet.add(a.key);
      if (activeSet.size === 0) activeSet.add('system');
      onChange();
    });
    root.appendChild(chip);
  }
}

// ───── Area mini cards (current slot) ────────────────────────

export function renderAreaMini(records) {
  const root = document.getElementById('area-prices');
  clear(root);
  if (!records.length) return;
  const today = records[records.length - 1].date;
  const todayRows = records.filter(r => r.date === today);
  const last = todayRows[todayRows.length - 1];
  if (!last) return;

  const prices = AREAS.filter(a => a.key !== 'system').map(a => ({ a, p: last[a.key] }));
  const valid = prices.filter(x => x.p != null).map(x => x.p);
  const max = Math.max(...valid), min = Math.min(...valid);

  for (const { a, p } of prices) {
    const node = el('div', 'mini' + (p === max ? ' high' : p === min ? ' low' : ''));
    node.innerHTML = `
      <div class="area" style="color:${a.color}">${a.label}</div>
      <div class="price">${fmt.yen(p, 2)}</div>
      <div class="delta">${p === max ? '最高' : p === min ? '最安' : ''}</div>
    `;
    root.appendChild(node);
  }
}

// ───── Profile (today peak/off-peak) ─────────────────────────

export function renderProfile(records) {
  const root = document.getElementById('profile-grid');
  clear(root);
  if (!records.length) return;
  const today = records[records.length - 1].date;
  const todayRows = records.filter(r => r.date === today && r.system != null);
  if (!todayRows.length) return;

  const peakSlots = todayRows.filter(r => r.slot >= 17 && r.slot <= 36); // 8:00-18:00
  const offSlots  = todayRows.filter(r => r.slot < 17 || r.slot > 36);
  const avg = arr => arr.length ? arr.reduce((s, r) => s + r.system, 0) / arr.length : null;

  const max = todayRows.reduce((m, r) => r.system > (m?.system ?? -Infinity) ? r : m, null);
  const min = todayRows.reduce((m, r) => r.system < (m?.system ?? Infinity) ? r : m, null);

  const cards = [
    { tone: 'volt',  label: '昼間平均', value: fmt.yen(avg(peakSlots)), sub: '8:00–18:00' },
    { tone: 'mint',  label: '夜間平均', value: fmt.yen(avg(offSlots)), sub: '其他コマ' },
    { tone: 'rose',  label: '最高値',   value: fmt.yen(max?.system),   sub: max ? SLOT_LABELS[max.slot - 1] : '—' },
    { tone: 'sun',   label: '最安値',   value: fmt.yen(min?.system),   sub: min ? SLOT_LABELS[min.slot - 1] : '—' },
  ];

  for (const c of cards) {
    const node = el('div', 'kpi');
    node.dataset.tone = c.tone;
    node.innerHTML = `
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      <div class="sub">${c.sub}</div>`;
    root.appendChild(node);
  }
}

// ───── Intraday chart ────────────────────────────────────────

let intradayChart = null;
export function renderIntradayChart(records) {
  const canvas = document.getElementById('intraday-chart');
  if (!canvas) return;
  if (!records || !records.length) {
    document.getElementById('intraday-meta').textContent = 'データなし';
    document.getElementById('intraday-latest').textContent = '—';
    if (intradayChart) { intradayChart.destroy(); intradayChart = null; }
    drawEmptyState(canvas, '時間前データなし');
    return;
  }

  const today = records[records.length - 1].date;
  const todayRows = records.filter(r => r.date === today);
  const labels = todayRows.map(r => SLOT_LABELS[r.slot - 1] || `#${r.slot}`);

  const last = todayRows[todayRows.length - 1];
  document.getElementById('intraday-meta').textContent = `${today} · ${todayRows.length} コマ`;
  document.getElementById('intraday-latest').textContent = fmt.yen(last?.price);

  const datasets = [
    { label: '加重平均価格', data: todayRows.map(r => r.price), borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.15)', fill: true, borderWidth: 2.5 },
  ];
  if (todayRows.some(r => r.high != null)) {
    datasets.push({ label: '高値', data: todayRows.map(r => r.high), borderColor: '#fb7185', borderDash: [4, 3], borderWidth: 1.2 });
    datasets.push({ label: '安値', data: todayRows.map(r => r.low),  borderColor: '#4ade80', borderDash: [4, 3], borderWidth: 1.2 });
  }

  if (typeof Chart === 'undefined') {
    drawEmptyState(canvas, 'Chart.js のロードに失敗 (CDN ブロック?)');
    return;
  }
  if (intradayChart) intradayChart.destroy();
  intradayChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: baseChartOptions(),
  });
}

// ───── Forward table ─────────────────────────────────────────

export function renderForward(rows) {
  const tbody = document.querySelector('#forward-table tbody');
  clear(tbody);
  document.getElementById('forward-meta').textContent = rows.length ? `直近 ${rows.length} 商品` : 'データなし';
  if (!rows.length) {
    tbody.appendChild(el('tr', 'empty', '<td colspan="5">先渡市場データを取得できませんでした</td>'));
    return;
  }
  for (const r of rows.slice(0, 30)) {
    const tr = el('tr');
    tr.innerHTML = `
      <td>${r.product || '—'}</td>
      <td class="text-slate-400">${r.period || '—'}</td>
      <td class="num right">${fmt.yen(r.price24)}</td>
      <td class="num right">${fmt.yen(r.priceDay)}</td>
      <td class="num right">${r.volume == null ? '—' : fmt.num(r.volume)}</td>`;
    tbody.appendChild(tr);
  }
}

// ───── Baseload table ────────────────────────────────────────

export function renderBaseload(rows) {
  const tbody = document.querySelector('#baseload-table tbody');
  clear(tbody);
  document.getElementById('baseload-meta').textContent = rows.length ? `${rows.length} レコード` : 'データなし';
  if (!rows.length) {
    tbody.appendChild(el('tr', 'empty', '<td colspan="4">ベースロード市場データを取得できませんでした</td>'));
    return;
  }
  for (const r of rows.slice(0, 30)) {
    const tr = el('tr');
    tr.innerHTML = `
      <td>${r.fy || '—'}</td>
      <td class="text-slate-400">${r.area || '—'}</td>
      <td class="num right">${fmt.yen(r.price)}</td>
      <td class="num right">${r.volume == null ? '—' : fmt.num(r.volume)}</td>`;
    tbody.appendChild(tr);
  }
}

// ───── FIP chart + areas ─────────────────────────────────────

let fipChart = null;
export function renderFip(records) {
  const meta = document.getElementById('fip-meta');
  const canvas = document.getElementById('fip-chart');
  const areasRoot = document.getElementById('fip-areas');
  clear(areasRoot);

  if (!records || !records.length) {
    meta.textContent = 'データなし';
    if (fipChart) { fipChart.destroy(); fipChart = null; }
    drawEmptyState(canvas, 'FIP データなし');
    return;
  }

  const labels = records.map(r => r.date);
  const datasets = AREAS.filter(a => a.key !== 'system').map(a => ({
    label: a.label,
    data: records.map(r => r[a.key]),
    borderColor: a.color,
    backgroundColor: a.color + '22',
    borderWidth: 1.6,
  }));

  meta.textContent = `${records.length} 期間`;

  if (typeof Chart === 'undefined') {
    drawEmptyState(canvas, 'Chart.js のロードに失敗 (CDN ブロック?)');
    return;
  }
  if (fipChart) fipChart.destroy();
  fipChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: baseChartOptions(),
  });

  // 直近期間のエリア mini
  const last = records[records.length - 1];
  for (const a of AREAS.filter(x => x.key !== 'system')) {
    const node = el('div', 'mini');
    node.innerHTML = `
      <div class="area" style="color:${a.color}">${a.label}</div>
      <div class="price">${fmt.yen(last[a.key], 2)}</div>
      <div class="delta">${last.date}</div>`;
    areasRoot.appendChild(node);
  }
}

// ───── Status / header ───────────────────────────────────────

export function setStatus({ updatedAt, line, state }) {
  if (updatedAt) {
    const t = new Date(updatedAt);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    document.getElementById('last-updated').textContent = `${hh}:${mm}:${ss}`;
  }
  if (line != null) document.getElementById('status-line').textContent = line;
  const dot = document.getElementById('live-dot');
  dot.classList.remove('stale', 'error');
  if (state === 'stale') dot.classList.add('stale');
  if (state === 'error') dot.classList.add('error');
}

export function setRefreshing(on) {
  document.getElementById('refresh-btn').classList.toggle('spinning', on);
}

// 3-state status badge: 'live' | 'connecting' | 'partial' | 'demo'
const MODE_STYLES = {
  live:       { cls: 'mode-live',       label: 'LIVE',       meta: '本番データ' },
  connecting: { cls: 'mode-connecting', label: 'CONNECTING', meta: 'JEPX 接続中…' },
  partial:    { cls: 'mode-partial',    label: 'PARTIAL',    meta: '一部接続失敗' },
  demo:       { cls: 'mode-demo',       label: 'DEMO',       meta: 'デモデータ' },
};
export function setMode(state, meta) {
  const badge = document.getElementById('mode-badge');
  if (!badge) return;
  const def = MODE_STYLES[state] || MODE_STYLES.connecting;
  badge.className = 'mode-badge ' + def.cls;
  badge.innerHTML = `<span class="dot"></span><span class="label">${def.label}</span><span class="meta">${meta || def.meta}</span>`;
}

// ───── PLANT (奈良吉野発電所) ────────────────────────────────

let plantCharts = { hourly: null, daily: null };
const plantPrev = {};   // 値変化アニメ用

function setPlantText(id, text) {
  const e = document.getElementById(id);
  if (e) e.textContent = text;
}

function animatePlantValue(id, next, formatter, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = plantPrev[key ?? id];
  if (prev != null && next != null && Math.abs(prev - next) > 1e-6) {
    animateValue(el, prev, next, formatter, 700);
  } else {
    el.textContent = formatter(next);
  }
  plantPrev[key ?? id] = next;
}

export function renderPlant(p) {
  if (!p) return;

  // メタ
  setPlantText('plant-type', p.type);
  setPlantText('plant-capacity', `${(p.capacityKw / 1000).toFixed(1)} MW`);
  setPlantText('plant-op-start', p.operationStart);
  setPlantText('plant-since', p.operationStart);

  // 値 (アニメ更新)
  animatePlantValue('plant-current',     p.currentKw,                    v => `${(v / 1000).toFixed(2)} MW`);
  animatePlantValue('plant-cf',          p.capacityFactor,               v => `${v.toFixed(1)}%`);
  animatePlantValue('plant-today-kwh',   p.todayKwh,                     v => `${(v / 1000).toFixed(1)} MWh`);
  animatePlantValue('plant-today-peak',  p.todayPeakKw,                  v => `${(v / 1000).toFixed(2)} MW`);
  animatePlantValue('plant-30-kwh',      p.last30Kwh,                    v => `${(v / 1000).toFixed(0)} MWh`);
  animatePlantValue('plant-30-cf',       p.last30CapacityFactor,         v => `${v.toFixed(1)}%`);
  animatePlantValue('plant-cumulative',  p.cumulativeMWh,                v => `${Math.round(v).toLocaleString('ja-JP')} MWh`);

  // 前日比
  const dod = document.getElementById('plant-dod');
  if (dod) {
    if (p.dayOnDayPct == null) {
      dod.textContent = '—';
      dod.classList.remove('up', 'down');
    } else {
      dod.textContent = `${p.dayOnDayPct > 0 ? '+' : ''}${p.dayOnDayPct.toFixed(1)}%`;
      dod.classList.toggle('up',   p.dayOnDayPct > 0);
      dod.classList.toggle('down', p.dayOnDayPct < 0);
    }
  }

  // 24h チャート
  const c1 = document.getElementById('plant-hourly-chart');
  if (c1 && typeof Chart !== 'undefined') {
    const labels = p.todayHourly.map(h => `${String(h.hour).padStart(2, '0')}:00`);
    const data = p.todayHourly.map(h => h.kw / 1000);
    if (plantCharts.hourly) plantCharts.hourly.destroy();
    plantCharts.hourly = new Chart(c1, {
      type: 'line',
      data: { labels, datasets: [{
        label: '出力',
        data,
        borderColor: '#22d3ee',
        backgroundColor: (ctx) => {
          const { ctx: c, chartArea } = ctx.chart;
          if (!chartArea) return 'rgba(34,211,238,0.12)';
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, 'rgba(34,211,238,0.45)');
          g.addColorStop(1, 'rgba(34,211,238,0.00)');
          return g;
        },
        fill: true, tension: 0.35, borderWidth: 2,
        pointRadius: 0, pointHoverRadius: 4,
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(10,14,26,0.95)',
            borderColor: 'rgba(34,211,238,0.40)',
            borderWidth: 1, cornerRadius: 8,
            titleColor: '#7df9ff', bodyColor: '#e2e8f0',
            callbacks: { label: c => `${c.parsed.y.toFixed(2)} MW` },
          },
        },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 9 }, autoSkip: true, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: '#64748b', font: { size: 9 }, callback: v => `${v}MW` }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, suggestedMax: p.capacityKw / 1000 },
        },
      },
    });
  }

  // 7日 棒チャート
  const c2 = document.getElementById('plant-daily-chart');
  if (c2 && typeof Chart !== 'undefined') {
    const labels = p.last7.map(d => d.date.slice(5));
    const data   = p.last7.map(d => d.kwh / 1000);
    if (plantCharts.daily) plantCharts.daily.destroy();
    plantCharts.daily = new Chart(c2, {
      type: 'bar',
      data: { labels, datasets: [{
        label: '日次発電量',
        data,
        backgroundColor: (ctx) => {
          const idx = ctx.dataIndex;
          const isToday = idx === data.length - 1;
          const { ctx: c, chartArea } = ctx.chart;
          if (!chartArea) return isToday ? '#facc15' : '#22d3ee';
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          if (isToday) {
            g.addColorStop(0, '#fde68a'); g.addColorStop(1, '#f59e0b');
          } else {
            g.addColorStop(0, '#7df9ff'); g.addColorStop(1, '#0ea5b7');
          }
          return g;
        },
        borderRadius: 4, borderSkipped: false,
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(10,14,26,0.95)',
            borderColor: 'rgba(34,211,238,0.40)',
            borderWidth: 1, cornerRadius: 8,
            titleColor: '#7df9ff', bodyColor: '#e2e8f0',
            callbacks: { label: c => `${c.parsed.y.toFixed(1)} MWh` },
          },
        },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: '#64748b', font: { size: 9 }, callback: v => `${v}` }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true },
        },
      },
    });
  }
}

// ───── Connection Diagnostics ────────────────────────────────

const MARKET_LABEL = {
  spot: 'スポット', intraday: '時間前', forward: '先渡', baseload: 'ベースロード', fip: 'FIP',
};

export function showDiagnostics(show) {
  const panel = document.getElementById('diag-panel');
  if (!panel) return;
  panel.classList.toggle('hidden', !show);
}

export function renderDiagnostics({ results = [], modeMeta = '' } = {}) {
  const body = document.getElementById('diag-body');
  const meta = document.getElementById('diag-meta');
  if (!body) return;

  if (meta) meta.textContent = modeMeta || '—';
  body.innerHTML = '';

  if (!results.length) {
    body.innerHTML = '<p class="diag-loading">probing…</p>';
    return;
  }

  for (const r of results) {
    const wrap = el('div', 'diag-row');
    const tried = r.tried || [];
    wrap.innerHTML = `
      <div class="diag-row-head">
        <span class="name">${MARKET_LABEL[r.key] || r.key}</span>
        <span class="pill ${r.ok ? 'ok' : 'fail'}">${r.ok ? 'LIVE' : 'FAIL'}</span>
        <span class="meta">${r.ok ? `${r.count}件 via ${r.via}` : `${tried.length} URL 試行`}</span>
      </div>
    `;
    if (!r.ok && tried.length) {
      const list = el('div', 'diag-tried');
      tried.slice(0, 12).forEach(att => {
        const cls = att.ok ? 's-ok' : (att.status === 0 || att.status >= 500 ? 's-warn' : 's-fail');
        const row = el('div', `diag-attempt ${cls}`);
        row.innerHTML = `
          <span class="via">${att.via || ''}</span>
          <span class="status">${att.ok ? 'OK' : (att.status || 'ERR')}${att.reason ? ` ${att.reason}` : ''}</span>
          <span class="url">${att.url || ''}</span>
          <span class="ms">${att.ms != null ? att.ms + 'ms' : ''}</span>`;
        list.appendChild(row);
      });
      wrap.appendChild(list);
    }
    if (r.ok) {
      const tip = el('div', 'diag-tip', `via <code>${r.via}</code> · <code>${r.sourceUrl || ''}</code>`);
      wrap.appendChild(tip);
    }
    body.appendChild(wrap);
  }

  const tip = el('div', 'diag-tip',
    `直接デバッグ: <code>${location.origin}/api/jepx?diag=1</code> を新規タブで開いて JSON を確認できます。`);
  body.appendChild(tip);
}

// ───── 天気予報 (30 分予報 / 24h) ────────────────────────────

let _weatherLastHash = '';

export function renderWeather(slots) {
  if (!slots || !slots.length) return;
  const strip = document.getElementById('weather-strip');
  if (!strip) return;

  // 直近表示の更新
  const now = slots[0];
  if (now) {
    const ic = document.getElementById('weather-now-icon');
    const co = document.getElementById('weather-now-cond');
    const tp = document.getElementById('weather-now-temp');
    if (ic) ic.textContent = now.condition.icon;
    if (co) co.textContent = now.condition.label;
    if (tp) tp.textContent = `${now.temp.toFixed(1)}°C`;
  }

  // セル群: ハッシュで再描画判定 (時刻は分単位で動くので必要分だけ)
  const hash = slots.map(s => `${s.timeStr}:${s.condition.key}:${s.temp}:${s.expectedKw}`).join('|');
  if (hash === _weatherLastHash) return;
  _weatherLastHash = hash;

  strip.innerHTML = '';
  slots.forEach((s, i) => {
    const cell = el('div', 'weather-cell' + (s.isNow ? ' now' : '') + (s.expectedKw === 0 ? ' night' : ''));
    cell.style.setProperty('--cond-color', s.condition.color);
    cell.style.animationDelay = `${i * 12}ms`;
    cell.title = `${s.timeStr} · ${s.condition.label} · ${s.temp.toFixed(1)}°C · 雲量 ${s.cloudPct}% · 予測出力 ${(s.expectedKw / 1000).toFixed(2)} MW`;
    cell.innerHTML = `
      <div class="time">${s.timeStr}</div>
      <div class="icon">${s.condition.icon}</div>
      <div class="temp">${s.temp.toFixed(1)}°</div>
      <div class="kw">${s.expectedKw === 0 ? '—' : `${(s.expectedKw / 1000).toFixed(2)}MW`}</div>
    `;
    strip.appendChild(cell);
  });
}

// ───── KANSAI HERO ───────────────────────────────────────────

const heroState = { lastPrice: null, lastTickHash: null };

export function renderHero(spotRecords, intradayRecords) {
  if (!spotRecords || !spotRecords.length) return;

  const dates = [...new Set(spotRecords.map(r => r.date))].sort();
  const today = dates[dates.length - 1];
  const yesterday = dates[dates.length - 2];

  const todayRows = spotRecords.filter(r => r.date === today);
  const yRows     = spotRecords.filter(r => r.date === yesterday);
  if (!todayRows.length) return;

  const last = todayRows[todayRows.length - 1];
  const open = todayRows.find(r => r.kansai != null)?.kansai ?? null;
  const kansaiVals = todayRows.map(r => r.kansai).filter(v => v != null);
  if (!kansaiVals.length) return;

  const high = Math.max(...kansaiVals);
  const low  = Math.min(...kansaiVals);
  const vwap = avg(kansaiVals);
  const vol  = todayRows.reduce((s, r) => s + (r.volume || 0), 0);
  const sellVol = todayRows.reduce((s, r) => s + (r.sellVol || 0), 0);
  const buyVol  = todayRows.reduce((s, r) => s + (r.buyVol  || 0), 0);
  const spread = (last.kansai != null && last.system != null) ? last.kansai - last.system : null;

  const yClose = yRows.length ? yRows.map(r => r.kansai).filter(v => v != null).slice(-1)[0] ?? null : null;
  const dayDeltaAbs = (last.kansai != null && yClose != null) ? last.kansai - yClose : null;
  const dayDeltaPct = (yClose) ? (dayDeltaAbs / yClose) * 100 : null;

  // 現在価格 (アニメ更新)
  const priceEl = document.getElementById('hero-price');
  if (priceEl) {
    const prev = heroState.lastPrice;
    if (prev != null && Math.abs(prev - last.kansai) > 1e-6) {
      animateValue(priceEl, prev, last.kansai, (v) => `¥${v.toFixed(2)}`, 800);
      priceEl.classList.remove('flash-up', 'flash-down');
      void priceEl.offsetWidth;
      priceEl.classList.add(last.kansai > prev ? 'flash-up' : 'flash-down');
    } else {
      priceEl.textContent = `¥${last.kansai.toFixed(2)}`;
    }
    heroState.lastPrice = last.kansai;
  }

  // delta
  const dpct = document.getElementById('hero-delta-pct');
  const dabs = document.getElementById('hero-delta-abs');
  if (dpct) {
    const cls = dayDeltaPct == null ? '' : dayDeltaPct > 0 ? 'up' : dayDeltaPct < 0 ? 'down' : '';
    const arrow = dayDeltaPct == null ? '' : dayDeltaPct > 0 ? '▲' : dayDeltaPct < 0 ? '▼' : '—';
    dpct.className = 'hero-delta ' + cls;
    dpct.textContent = dayDeltaPct == null ? '— %' : `${arrow} ${fmt.pct(dayDeltaPct)}`;
    if (dabs) dabs.textContent = dayDeltaAbs == null ? '' : `${dayDeltaAbs > 0 ? '+' : ''}${dayDeltaAbs.toFixed(2)} 円`;
  }

  // OHLC + VWAP + VOL + spread
  setText('hero-open',  open == null ? '¥—' : fmt.yen(open));
  setText('hero-high',  fmt.yen(high));
  setText('hero-low',   fmt.yen(low));
  setText('hero-vwap',  fmt.yen(vwap));
  setText('hero-vol',   fmt.gwh(vol));
  if (spread != null) {
    const el = document.getElementById('hero-spread');
    if (el) {
      const cls = spread > 0 ? 'hi' : spread < 0 ? 'lo' : '';
      el.className = (cls ? cls : '');
      el.textContent = `${spread > 0 ? '+' : ''}${spread.toFixed(2)}`;
    }
  } else setText('hero-spread', '—');

  // Day range
  const fill = document.getElementById('hero-range-fill');
  const marker = document.getElementById('hero-range-marker');
  if (fill && marker && high > low) {
    const pct = ((last.kansai - low) / (high - low)) * 100;
    const clamped = Math.max(0, Math.min(100, pct));
    fill.style.width = clamped + '%';
    marker.style.left = clamped + '%';
  }
  setText('hero-range-low',  fmt.yen(low));
  setText('hero-range-high', fmt.yen(high));

  // ボリューム
  const totalVol = sellVol + buyVol || 1;
  const sellPct = (sellVol / totalVol) * 100;
  const buyPct  = (buyVol  / totalVol) * 100;
  const sellEl = document.getElementById('hero-sell');
  const buyEl  = document.getElementById('hero-buy');
  if (sellEl) sellEl.style.width = sellPct.toFixed(1) + '%';
  if (buyEl)  buyEl.style.width  = buyPct.toFixed(1)  + '%';
  setText('hero-sell-val', fmt.gwh(sellVol));
  setText('hero-buy-val',  fmt.gwh(buyVol));

  // Tick tape (直近 24 コマ、前コマ差分で色分け)
  renderHeroTape(todayRows.slice(-24));

  // Sparkline
  drawHeroSpark(todayRows);
  setText('hero-spark-stat', `H ${fmt.yen(high)}  L ${fmt.yen(low)}  VWAP ${fmt.yen(vwap)}`);
}

function renderHeroTape(rows) {
  const tape = document.getElementById('hero-tape');
  if (!tape) return;
  const hash = rows.map(r => `${r.slot}:${r.kansai}`).join('|');
  if (hash === heroState.lastTickHash) return;
  heroState.lastTickHash = hash;
  tape.innerHTML = '';
  let prev = null;
  const vals = rows.map(r => r.kansai).filter(v => v != null);
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;
  const range = Math.max(0.5, max - min);
  rows.forEach((r, i) => {
    const v = r.kansai;
    if (v == null) return;
    const cls = prev == null ? 'flat' : v > prev ? 'up' : v < prev ? 'down' : 'flat';
    prev = v;
    const heightPct = 25 + ((v - min) / range) * 75;
    const bar = document.createElement('div');
    bar.className = 'tick-bar ' + cls + (i === rows.length - 1 ? ' last' : '');
    bar.style.height = heightPct.toFixed(1) + '%';
    bar.style.animationDelay = `${i * 14}ms`;
    bar.title = `${SLOT_LABELS[r.slot - 1]} ¥${v.toFixed(2)}`;
    tape.appendChild(bar);
  });
}

function drawHeroSpark(rows) {
  const canvas = document.getElementById('hero-spark');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const data = rows.map(r => r.kansai).filter(v => v != null);
  if (data.length < 2) return;
  const min = Math.min(...data), max = Math.max(...data);
  const range = Math.max(0.5, max - min);
  const step = w / (data.length - 1);
  const padTop = 18, padBottom = 6;
  const innerH = h - padTop - padBottom;

  // baseline area
  const grad = ctx.createLinearGradient(0, padTop, 0, h - padBottom);
  grad.addColorStop(0, 'rgba(250, 204, 21, 0.40)');
  grad.addColorStop(1, 'rgba(250, 204, 21, 0.00)');
  ctx.beginPath();
  ctx.moveTo(0, h - padBottom);
  data.forEach((v, i) => {
    const x = i * step;
    const y = padTop + (1 - (v - min) / range) * innerH;
    if (i === 0) ctx.lineTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo((data.length - 1) * step, h - padBottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * step;
    const y = padTop + (1 - (v - min) / range) * innerH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(250, 204, 21, 0.55)';
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // current marker (脈動)
  const lastIdx = data.length - 1;
  const lx = lastIdx * step;
  const ly = padTop + (1 - (data[lastIdx] - min) / range) * innerH;
  const t = (performance.now() % 1400) / 1400;
  const r = 3 + Math.sin(t * Math.PI * 2) * 1.5;
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(lx, ly, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(250,204,21,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(lx, ly, r + 4, 0, Math.PI * 2);
  ctx.stroke();
}

// 常時動かす要素 — 時計を毎秒、スパーク marker pulse を ~12fps で
let _heroAnimRaf = null;
let _heroLastSpark = 0;
let _heroLastClock = 0;
export function startHeroAnimations(getRows) {
  function tick() {
    const now = performance.now();

    if (now - _heroLastClock >= 250) {
      _heroLastClock = now;
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      const slot = Math.min(48, Math.floor((d.getHours() * 60 + d.getMinutes()) / 30) + 1);
      const t = document.getElementById('hero-clock-time');
      if (t) t.innerHTML = `${hh}<span class="sep">:</span>${mm}<span class="sep">:</span>${ss}`;
      const s = document.getElementById('hero-clock-slot');
      if (s) s.textContent = `SLOT ${slot} · ${SLOT_LABELS[slot - 1]}`;
    }

    if (now - _heroLastSpark >= 80) {
      _heroLastSpark = now;
      const rows = getRows ? getRows() : null;
      if (rows && rows.length) drawHeroSpark(rows);
    }

    _heroAnimRaf = requestAnimationFrame(tick);
  }
  if (!_heroAnimRaf) _heroAnimRaf = requestAnimationFrame(tick);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }

// ───── Ticker bar ────────────────────────────────────────────

const tickerPrev = new Map();   // 直近価格 (色決定用)

export function renderTicker(spotRecords, intradayRecords) {
  const track = document.getElementById('ticker-track');
  if (!track) return;
  const items = [];

  if (spotRecords && spotRecords.length) {
    const today = spotRecords[spotRecords.length - 1].date;
    const todayRows = spotRecords.filter(r => r.date === today);
    const last = todayRows[todayRows.length - 1];
    if (last) {
      for (const a of AREAS) {
        const v = last[a.key];
        if (v == null) continue;
        const k = `area:${a.key}`;
        const prev = tickerPrev.get(k);
        const dCls = prev == null ? 'delta-flat' : v > prev ? 'delta-up' : v < prev ? 'delta-down' : 'delta-flat';
        const dArrow = prev == null ? '·' : v > prev ? '▲' : v < prev ? '▼' : '—';
        items.push(`
          <span class="ticker-item">
            <span class="name" style="color:${a.color}">${a.label}</span>
            <span class="price">¥${v.toFixed(2)}</span>
            <span class="${dCls}">${dArrow}${prev != null ? ` ${(v - prev > 0 ? '+' : '')}${(v - prev).toFixed(2)}` : ''}</span>
          </span>`);
        tickerPrev.set(k, v);
      }
    }
  }

  if (intradayRecords && intradayRecords.length) {
    const last = intradayRecords[intradayRecords.length - 1];
    if (last && last.price != null) {
      const k = 'im:price';
      const prev = tickerPrev.get(k);
      const dCls = prev == null ? 'delta-flat' : last.price > prev ? 'delta-up' : last.price < prev ? 'delta-down' : 'delta-flat';
      const dArrow = prev == null ? '·' : last.price > prev ? '▲' : last.price < prev ? '▼' : '—';
      items.push(`
        <span class="ticker-item">
          <span class="name" style="color:#fb7185">時間前 加重平均</span>
          <span class="price">¥${last.price.toFixed(2)}</span>
          <span class="${dCls}">${dArrow}</span>
        </span>`);
      tickerPrev.set(k, last.price);
    }
  }

  if (items.length === 0) {
    track.innerHTML = '<span class="ticker-loading">streaming…</span>';
    return;
  }

  // セパレータ挟みつつ 2 周ぶん複製で seamless ループ
  const separator = '<span class="sep">·</span>';
  const segment = items.join(separator);
  track.innerHTML = segment + separator + segment;
}

// ───── Countdown ring ────────────────────────────────────────

let countdownState = { nextAt: 0, total: 60_000, raf: null };

export function startCountdown(intervalMs) {
  countdownState.total = intervalMs;
  countdownState.nextAt = Date.now() + intervalMs;
  if (!countdownState.raf) countdownState.raf = requestAnimationFrame(tickCountdown);
}

export function resetCountdown(intervalMs) {
  countdownState.total = intervalMs ?? countdownState.total;
  countdownState.nextAt = Date.now() + countdownState.total;
}

function tickCountdown() {
  const ring = document.getElementById('countdown-ring');
  if (ring) {
    const remaining = Math.max(0, countdownState.nextAt - Date.now());
    const pct = 1 - (remaining / countdownState.total);
    ring.style.setProperty('--pct', pct.toFixed(3));
  }
  countdownState.raf = requestAnimationFrame(tickCountdown);
}

// ───── Fullscreen ────────────────────────────────────────────

export function toggleFullscreen() {
  const doc = document;
  const el = document.documentElement;
  const isFull = doc.fullscreenElement || doc.webkitFullscreenElement;
  if (!isFull) {
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  } else {
    (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(doc);
  }
}

function drawEmptyState(canvas, message) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = '#475569';
  ctx.font = "500 13px " + CHART_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, rect.width / 2, rect.height / 2);
}
