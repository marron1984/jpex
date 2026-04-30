// JEPX Live — エントリーポイント

import { REFRESH_MS, SOURCES, AREAS, fiscalYear } from './config.js?v=2026.04.30.3';
import { fetchCsv } from './fetcher.js?v=2026.04.30.3';
import { parseCsvWithHeader } from './csv.js?v=2026.04.30.3';
import { parseSpot, parseIntraday, parseForward, parseBaseload, parseFip } from './markets.js?v=2026.04.30.3';
import { demoSpot, demoIntraday, demoForward, demoBaseload, demoFip } from './demo.js?v=2026.04.30.3';
import {
  renderKpis, renderSpotChart, renderAreaToggles, renderAreaMini,
  renderProfile, renderIntradayChart, renderForward, renderBaseload,
  renderFip, renderTicker, renderHero, startHeroAnimations,
  setStatus, setRefreshing, setMode,
  startCountdown, resetCountdown, toggleFullscreen,
} from './ui.js?v=2026.04.30.3';

// ───── 状態 ─────────────────────────────────────────────────────
const state = {
  spot: [], intraday: [], forward: [], baseload: [], fip: [],
  isDemo: { spot: false, intraday: false, forward: false, baseload: false, fip: false },
  everSucceeded: false,
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
    let s = u;
    s = s.replaceAll('{YEAR}',      String(yr));
    s = s.replaceAll('{YEAR_PREV}', String(yr - 1));
    s = s.replaceAll('{FY}',        String(fy));
    s = s.replaceAll('{FY_PREV}',   String(fy - 1));
    out.push(s);
  }
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
  // 起動直後だけ「接続中…」表示。それ以降は直前の表示を維持
  if (!state.everSucceeded) setMode('connecting', 'JEPX 接続中…');
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

  // 失敗した市場のうち、本物データを一度も持っていない市場のみデモで埋める
  for (const r of ng) {
    const fallback = DEMO_FALLBACK[r.key];
    if (fallback && (!state[r.key] || !state[r.key].length)) {
      state[r.key] = fallback();
      state.isDemo[r.key] = true;
    }
  }
  if (ok.length) state.everSucceeded = true;
  const demoCount = Object.values(state.isDemo).filter(Boolean).length;

  render();

  const labels = (arr) => arr.map(r => SOURCES[r.key].label).join(' / ');
  let line = '', mode = 'live', meta = '本番データ';
  if (ok.length === 5) {
    line = `全 5 市場 LIVE (${ok.map(r => `${SOURCES[r.key].label}: ${r.count}件`).join(' · ')})`;
    mode = 'live'; meta = `5/5 LIVE`;
  } else if (ok.length > 0) {
    line = `取得成功: ${labels(ok)} / 失敗: ${labels(ng)}`;
    mode = 'partial'; meta = `${ok.length}/5 LIVE${demoCount ? ` · DEMO×${demoCount}` : ''}`;
  } else {
    line = isFileProtocol()
      ? `file:// では fetch がブロック。ローカルサーバ経由で開いてください`
      : `JEPX への接続に失敗 (URL/CORS/ネットワーク)`;
    mode = 'demo'; meta = 'DEMO 表示';
  }
  setMode(mode, meta);
  setStatus({ updatedAt: Date.now(), line, state: mode === 'live' ? 'live' : mode === 'partial' ? 'stale' : 'error' });
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

// 1) 起動: 「接続中」状態で空のままレンダリング (デモを既定にしない)
setMode('connecting', 'JEPX 接続中…');
setStatus({ line: 'JEPX 接続中…' });
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
