// 描画レイヤ。Chart.js + DOM 操作。

import { AREAS, SLOT_LABELS } from './config.js';

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

export function renderKpis(metrics) {
  const root = document.getElementById('kpi-row');
  clear(root);

  const cards = [
    {
      tone: 'volt',
      label: '直近 システムP',
      value: fmt.yen(metrics.spotNow),
      sub: metrics.spotNowSlot ? `${SLOT_LABELS[metrics.spotNowSlot - 1]} コマ · ${fmt.date(metrics.spotNowDate)}` : '—',
      delta: metrics.spotNowDelta,
    },
    {
      tone: 'sun',
      label: '東京エリア',
      value: fmt.yen(metrics.tokyoNow),
      sub: '本日 · 直近コマ',
      delta: metrics.tokyoDelta,
    },
    {
      tone: 'mint',
      label: '本日 平均',
      value: fmt.yen(metrics.spotAvgToday),
      sub: `H ${fmt.yen(metrics.spotMaxToday)}  /  L ${fmt.yen(metrics.spotMinToday)}`,
    },
    {
      tone: 'rose',
      label: '時間前 加重平均',
      value: fmt.yen(metrics.intradayAvg),
      sub: metrics.intradayLatest ? `直近 ${fmt.yen(metrics.intradayLatest)}` : '—',
      delta: metrics.intradayDelta,
    },
    {
      tone: 'violet',
      label: '本日 約定量',
      value: fmt.gwh(metrics.spotVolToday),
      sub: '30分コマ合計',
    },
    {
      tone: 'slate',
      label: '前日比',
      value: fmt.pct(metrics.spotDayDelta),
      sub: metrics.spotAvgYesterday != null ? `昨日 ${fmt.yen(metrics.spotAvgYesterday)}` : '—',
    },
  ];

  for (const c of cards) {
    const node = el('div', 'kpi');
    node.dataset.tone = c.tone;
    const deltaCls = c.delta == null ? 'flat' : (c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : 'flat');
    const deltaTxt = c.delta == null ? '' : `<div class="delta ${deltaCls}">${c.delta > 0 ? '▲' : c.delta < 0 ? '▼' : '—'} ${fmt.pct(c.delta)}</div>`;
    node.innerHTML = `
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      ${deltaTxt}
      <div class="sub">${c.sub}</div>`;
    root.appendChild(node);
  }
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

export function setDemoMode(on, marketKeys = []) {
  const badge = document.getElementById('demo-badge');
  if (!badge) return;
  if (on) {
    badge.classList.remove('hidden');
    badge.classList.add('flex');
    badge.title = `デモデータ表示中: ${marketKeys.join(', ')}`;
  } else {
    badge.classList.add('hidden');
    badge.classList.remove('flex');
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
