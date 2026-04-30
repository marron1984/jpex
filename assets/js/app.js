// JEPX Live — エントリーポイント

import { REFRESH_MS, SOURCES, AREAS, fiscalYear } from './config.js';
import { fetchCsv } from './fetcher.js';
import { parseCsvWithHeader } from './csv.js';
import { parseSpot, parseIntraday, parseForward, parseBaseload, parseFip } from './markets.js';
import {
  renderKpis, renderSpotChart, renderAreaToggles, renderAreaMini,
  renderProfile, renderIntradayChart, renderForward, renderBaseload,
  renderFip, setStatus, setRefreshing,
} from './ui.js';

// ───── 状態 ─────────────────────────────────────────────────────
const state = {
  spot: [], intraday: [], forward: [], baseload: [], fip: [],
  spotRange: 'today',
  spotAreas: new Set(['system', 'tokyo']),
  errors: {},
  inFlight: null,
};

// 候補 URL を年/会計年度で展開
function expand(urls, now = new Date()) {
  const yr = now.getFullYear();
  const fy = fiscalYear(now);
  const out = [];
  for (const u of urls) {
    if (u.includes('{YEAR}')) out.push(u.replace('{YEAR}', yr));
    if (u.includes('{FY}'))   out.push(u.replace('{FY}', fy));
  }
  // 重複除去
  return [...new Set(out)];
}

// ───── 集計 (KPI 用) ─────────────────────────────────────────────

function deriveMetrics() {
  const m = {};
  if (state.spot.length) {
    const dates = [...new Set(state.spot.map(r => r.date))].sort();
    const today = dates[dates.length - 1];
    const yesterday = dates[dates.length - 2];
    const todayRows = state.spot.filter(r => r.date === today && r.system != null);
    const yRows = state.spot.filter(r => r.date === yesterday && r.system != null);

    if (todayRows.length) {
      const last = todayRows[todayRows.length - 1];
      m.spotNow = last.system;
      m.tokyoNow = last.tokyo;
      m.spotNowSlot = last.slot;
      m.spotNowDate = last.date;
      const prev = todayRows.length > 1 ? todayRows[todayRows.length - 2] : null;
      if (prev) m.spotNowDelta = pctDelta(prev.system, last.system);
      const prevTokyo = todayRows.find(r => r.slot === last.slot - 1);
      if (prevTokyo && prevTokyo.tokyo != null) m.tokyoDelta = pctDelta(prevTokyo.tokyo, last.tokyo);

      const sysVals = todayRows.map(r => r.system).filter(v => v != null);
      m.spotAvgToday = avg(sysVals);
      m.spotMaxToday = Math.max(...sysVals);
      m.spotMinToday = Math.min(...sysVals);
      m.spotVolToday = sum(todayRows.map(r => r.volume).filter(v => v != null));
    }
    if (yRows.length) {
      m.spotAvgYesterday = avg(yRows.map(r => r.system).filter(v => v != null));
      if (m.spotAvgToday != null && m.spotAvgYesterday != null) {
        m.spotDayDelta = pctDelta(m.spotAvgYesterday, m.spotAvgToday);
      }
    }
  }
  if (state.intraday.length) {
    const today = state.intraday[state.intraday.length - 1].date;
    const todayRows = state.intraday.filter(r => r.date === today && r.price != null);
    if (todayRows.length) {
      m.intradayAvg = avg(todayRows.map(r => r.price));
      m.intradayLatest = todayRows[todayRows.length - 1].price;
      const prev = todayRows.length > 1 ? todayRows[todayRows.length - 2] : null;
      if (prev) m.intradayDelta = pctDelta(prev.price, m.intradayLatest);
    }
  }
  return m;
}

function pctDelta(a, b) {
  if (a == null || b == null || !a) return null;
  return ((b - a) / Math.abs(a)) * 100;
}
function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }
function sum(arr) { return arr.reduce((s, v) => s + v, 0); }

// ───── 描画 ─────────────────────────────────────────────────────

function render() {
  renderKpis(deriveMetrics());
  renderSpotChart(state.spot, { range: state.spotRange, activeAreas: [...state.spotAreas] });
  renderAreaToggles(state.spotAreas, () => render());
  renderAreaMini(state.spot);
  renderProfile(state.spot);
  renderIntradayChart(state.intraday);
  renderForward(state.forward);
  renderBaseload(state.baseload);
  renderFip(state.fip);
}

// ───── データ取得 ───────────────────────────────────────────────

async function loadOne(key, parser, signal) {
  const cfg = SOURCES[key];
  const urls = expand(cfg.urls);
  try {
    const { text, sourceUrl } = await fetchCsv(urls, { signal });
    const parsed = parseCsvWithHeader(text);
    const data = parser(parsed);
    state[key] = data;
    state.errors[key] = null;
    return { key, ok: true, count: data.length, sourceUrl };
  } catch (e) {
    state.errors[key] = e;
    return { key, ok: false, error: e };
  }
}

async function loadAll() {
  if (state.inFlight) state.inFlight.abort();
  const ctrl = new AbortController();
  state.inFlight = ctrl;
  setRefreshing(true);
  setStatus({ line: 'JEPX からデータを取得中…' });

  const results = await Promise.all([
    loadOne('spot',     parseSpot,     ctrl.signal),
    loadOne('intraday', parseIntraday, ctrl.signal),
    loadOne('forward',  parseForward,  ctrl.signal),
    loadOne('baseload', parseBaseload, ctrl.signal),
    loadOne('fip',      parseFip,      ctrl.signal),
  ]);

  state.inFlight = null;
  setRefreshing(false);

  render();

  const ok = results.filter(r => r.ok);
  const ng = results.filter(r => !r.ok);
  const labels = (arr) => arr.map(r => SOURCES[r.key].label).join(' / ');
  let line = '';
  let stateTag = 'live';
  if (ok.length === 5) {
    line = `全 5 市場を取得 (${ok.map(r => `${SOURCES[r.key].label}: ${r.count}件`).join(' · ')})`;
  } else if (ok.length > 0) {
    line = `取得成功: ${labels(ok)} / 失敗: ${labels(ng)}`;
    stateTag = 'stale';
  } else {
    line = `データ取得に失敗しました。CSV エンドポイントが変更された可能性があります。コンソールを確認してください。`;
    stateTag = 'error';
  }
  setStatus({ updatedAt: Date.now(), line, state: stateTag });

  // デバッグ用にエラー内容を console に
  for (const r of ng) {
    console.warn(`[JEPX:${r.key}]`, r.error?.message || r.error, r.error?.detail);
  }
}

// ───── イベント ─────────────────────────────────────────────────

document.getElementById('refresh-btn').addEventListener('click', () => loadAll());

document.querySelectorAll('[data-spot-range]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-spot-range]').forEach(b => b.classList.remove('seg-active'));
    btn.classList.add('seg-active');
    state.spotRange = btn.dataset.spotRange;
    render();
  });
});

// ───── 起動 ─────────────────────────────────────────────────────

loadAll();
setInterval(loadAll, REFRESH_MS);

// タブが復帰した時にも更新
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadAll();
});
