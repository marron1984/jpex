// JEPX Live — エントリーポイント

import { REFRESH_MS, SOURCES, AREAS, fiscalYear } from './config.js?v=2026.04.30.2';
import { fetchCsv } from './fetcher.js?v=2026.04.30.2';
import { parseCsvWithHeader } from './csv.js?v=2026.04.30.2';
import { parseSpot, parseIntraday, parseForward, parseBaseload, parseFip } from './markets.js?v=2026.04.30.2';
import { demoSpot, demoIntraday, demoForward, demoBaseload, demoFip } from './demo.js?v=2026.04.30.2';
import {
  renderKpis, renderSpotChart, renderAreaToggles, renderAreaMini,
  renderProfile, renderIntradayChart, renderForward, renderBaseload,
  renderFip, renderTicker, renderHero, startHeroAnimations,
  setStatus, setRefreshing, setDemoMode,
  startCountdown, resetCountdown, toggleFullscreen,
} from './ui.js?v=2026.04.30.2';

// ───── 状態 ─────────────────────────────────────────────────────
const state = {
  spot: [], intraday: [], forward: [], baseload: [], fip: [],
  isDemo: { spot: false, intraday: false, forward: false, baseload: false, fip: false },
  spotRange: 'today',
  spotAreas: new Set(['system', 'kansai']),
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
      m.kansaiNow = last.kansai;
      m.kansaiSpread = (last.kansai != null && last.system != null) ? last.kansai - last.system : null;
      m.spotNowSlot = last.slot;
      m.spotNowDate = last.date;
      const prev = todayRows.length > 1 ? todayRows[todayRows.length - 2] : null;
      if (prev) m.spotNowDelta = pctDelta(prev.system, last.system);
      if (prev && prev.kansai != null && last.kansai != null) m.kansaiDelta = pctDelta(prev.kansai, last.kansai);

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
  renderHero(state.spot, state.intraday);
  renderKpis(deriveMetrics());
  renderSpotChart(state.spot, { range: state.spotRange, activeAreas: [...state.spotAreas] });
  renderAreaToggles(state.spotAreas, () => render());
  renderAreaMini(state.spot);
  renderProfile(state.spot);
  renderIntradayChart(state.intraday);
  renderForward(state.forward);
  renderBaseload(state.baseload);
  renderFip(state.fip);
  renderTicker(state.spot, state.intraday);
}

// ───── データ取得 ───────────────────────────────────────────────

async function loadOne(key, parser, signal) {
  const cfg = SOURCES[key];
  const urls = expand(cfg.urls);
  try {
    const { text, sourceUrl } = await fetchCsv(urls, { signal });
    const parsed = parseCsvWithHeader(text);
    const data = parser(parsed);
    if (!data.length) throw new Error('CSV パース結果が 0 件 (列レイアウト変更?)');
    state[key] = data;
    state.isDemo[key] = false;
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

  const ok = results.filter(r => r.ok);
  const ng = results.filter(r => !r.ok);

  // 失敗した市場はデモデータで埋める (UI を必ず描画)
  for (const r of ng) {
    const fallback = DEMO_FALLBACK[r.key];
    if (fallback) {
      state[r.key] = fallback();
      state.isDemo[r.key] = true;
    }
  }
  const demoUsed = Object.entries(state.isDemo).filter(([, v]) => v).map(([k]) => k);
  setDemoMode(demoUsed.length > 0, demoUsed);

  render();

  const labels = (arr) => arr.map(r => SOURCES[r.key].label).join(' / ');
  let line = '';
  let stateTag = 'live';
  if (ok.length === 5) {
    line = `全 5 市場を取得 (${ok.map(r => `${SOURCES[r.key].label}: ${r.count}件`).join(' · ')})`;
  } else if (ok.length > 0) {
    line = `取得成功: ${labels(ok)} / 失敗 (デモ表示): ${labels(ng)}`;
    stateTag = 'stale';
  } else {
    line = isFileProtocol()
      ? `file:// では fetch がブロックされます。ローカルサーバ (例: python3 -m http.server) 経由で開いてください。デモデータを表示中。`
      : `JEPX への接続に失敗。CORS / URL 変更の可能性があります。デモデータを表示中。`;
    stateTag = 'error';
  }
  setStatus({ updatedAt: Date.now(), line, state: stateTag });
  resetCountdown(REFRESH_MS);

  // デバッグ用にエラー内容を console に
  for (const r of ng) {
    console.warn(`[JEPX:${r.key}]`, r.error?.message || r.error, r.error?.detail);
  }
}

const DEMO_FALLBACK = {
  spot: demoSpot,
  intraday: demoIntraday,
  forward: demoForward,
  baseload: demoBaseload,
  fip: demoFip,
};

function isFileProtocol() {
  return typeof location !== 'undefined' && location.protocol === 'file:';
}

// ───── イベント ─────────────────────────────────────────────────

document.getElementById('refresh-btn').addEventListener('click', () => loadAll());
document.getElementById('fullscreen-btn').addEventListener('click', () => toggleFullscreen());

// キーボードショートカット: F = フルスクリーン, R = 即更新
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, [contenteditable]')) return;
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
  else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); loadAll(); }
});

document.querySelectorAll('[data-spot-range]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-spot-range]').forEach(b => b.classList.remove('seg-active'));
    btn.classList.add('seg-active');
    state.spotRange = btn.dataset.spotRange;
    render();
  });
});

// ───── 起動 ─────────────────────────────────────────────────────

// 1) まずデモデータで即座に描画 (空チャート回避)
state.spot     = demoSpot();      state.isDemo.spot     = true;
state.intraday = demoIntraday();  state.isDemo.intraday = true;
state.forward  = demoForward();   state.isDemo.forward  = true;
state.baseload = demoBaseload();  state.isDemo.baseload = true;
state.fip      = demoFip();       state.isDemo.fip      = true;
setDemoMode(true, ['spot', 'intraday', 'forward', 'baseload', 'fip']);
setStatus({ updatedAt: Date.now(), line: 'デモデータ表示中 — JEPX に接続中…', state: 'stale' });
render();

// 2) カウントダウンリング + Hero パネルの常時アニメーション開始
startCountdown(REFRESH_MS);
startHeroAnimations(() => {
  if (!state.spot || !state.spot.length) return [];
  const dates = [...new Set(state.spot.map(r => r.date))].sort();
  const today = dates[dates.length - 1];
  return state.spot.filter(r => r.date === today);
});

// 3) 実データ取得を開始
loadAll();
setInterval(loadAll, REFRESH_MS);

// タブが復帰した時にも更新
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadAll();
});
