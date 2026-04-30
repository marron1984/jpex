// JEPX Live — エントリーポイント

import { REFRESH_MS, SOURCES, AREAS, fiscalYear } from './config.js?v=2026.04.30.13';
import { fetchCsv, fetchMarketCsv } from './fetcher.js?v=2026.04.30.13';
import { parseCsvWithHeader } from './csv.js?v=2026.04.30.13';
import { parseSpot, parseIntraday, parseForward, parseBaseload, parseFip } from './markets.js?v=2026.04.30.13';
import { demoSpot, demoIntraday, demoForward, demoBaseload, demoFip } from './demo.js?v=2026.04.30.13';
import { demoPlant, demoWeather, demoRevenue } from './plant.js?v=2026.04.30.13';
import { fetchTso, buildSyntheticTso } from './tso.js?v=2026.04.30.13';
import {
  renderKpis, renderSpotChart, renderAreaToggles, renderAreaMini,
  renderProfile, renderIntradayChart, renderForward, renderBaseload,
  renderFip, renderTicker, renderHero, renderPlant, renderWeather,
  renderRevenue, renderTsoGrid,
  startHeroAnimations,
  setStatus, setRefreshing, setMode, setSnapshotInfo,
  startCountdown, resetCountdown, toggleFullscreen,
} from './ui.js?v=2026.04.30.13';

// ───── 状態 ─────────────────────────────────────────────────────
const state = {
  spot: [], intraday: [], forward: [], baseload: [], fip: [],
  isDemo: { spot: false, intraday: false, forward: false, baseload: false, fip: false },
  everSucceeded: false,
  spotRange: 'today',
  spotAreas: new Set(['system', 'kansai']),
  errors: {},
  tried: { spot: null, intraday: null, forward: null, baseload: null, fip: null },
  inFlight: null,
  tso: null,            // 9 TSO 需給データ ({ updatedAt, isLive, areas: { tokyo: {...}, ... } })
  tsoInFlight: null,
  // /api/jepx?market=X が返してきた X-Source / X-Snapshot-Age-Seconds を per-market で保持
  sources: { spot: null, intraday: null, forward: null, baseload: null, fip: null },
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
  const plant = demoPlant();
  renderPlant(plant);
  renderWeather(demoWeather());
  renderRevenue(demoRevenue(plant, state.spot), plant);
  renderTsoGrid(state.tso || buildSyntheticTso());
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
  // /api/jepx?market=<key> 一本。公開 CORS プロキシは JEPX に 403 されるので使わない。
  try {
    const r = await fetchMarketCsv(key, { signal });
    if (r.text) {
      const data = parser(parseCsvWithHeader(r.text));
      if (!data.length) throw new Error('CSV parse 0 件 (列レイアウト変更?)');
      state[key] = data;
      state.isDemo[key] = false;
      state.errors[key] = null;
      state.tried[key] = null;
      state.sources[key] = {
        source: r.source || 'live',         // 'live' | 'github-snapshot'
        snapshotAgeSec: r.snapshotAgeSec ?? null,
        snapshotAt: r.snapshotAt || null,
        sourceUrl: r.sourceUrl || null,
      };
      return { key, ok: true, count: data.length, sourceUrl: r.sourceUrl, via: r.source === 'github-snapshot' ? 'snapshot' : 'edge' };
    }
    const err = new Error(r.errors?.join(' / ') || 'no data');
    err.detail = r.errors || [];
    err.tried = r.tried || null;
    state.errors[key] = err;
    state.tried[key] = r.tried || null;
    state.sources[key] = null;
    return { key, ok: false, error: err };
  } catch (e) {
    state.errors[key] = e;
    state.tried[key] = null;
    state.sources[key] = null;
    return { key, ok: false, error: e };
  }
}

async function loadTso() {
  if (state.tsoInFlight) state.tsoInFlight.abort();
  const ctrl = new AbortController();
  state.tsoInFlight = ctrl;
  try {
    const r = await fetchTso({ signal: ctrl.signal });
    state.tso = r;
    renderTsoGrid(r);
    if (r.isLive) {
      console.log(`%c[TSO] ${r.liveCount}/9 LIVE`, 'color:#4ade80;font-weight:bold');
    } else {
      console.warn('[TSO] all areas synthesised — /api/denkiyoho unreachable', r.error || '');
    }
  } catch (e) {
    console.warn('[TSO] fetch failed', e);
  } finally {
    state.tsoInFlight = null;
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
    line = `全 5 市場 LIVE (${ok.map(r => `${SOURCES[r.key].label}: ${r.count}件 [${r.via}]`).join(' · ')})`;
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

  // スナップショット鮮度をヘッダピルに反映 (LIVE / SNAPSHOT 何分前 / 失敗)
  setSnapshotInfo(summarizeSnapshotInfo(state.sources));

  // デバッグ用にエラー内容を console に
  for (const r of ok) {
    console.log(`%c[JEPX:${r.key}] OK%c ${r.count}件 via ${r.via} %c${r.sourceUrl || ''}`,
      'color:#4ade80;font-weight:bold', 'color:#94a3b8', 'color:#64748b');
  }
  for (const r of ng) {
    console.group(`%c[JEPX:${r.key}] FAILED`, 'color:#fb7185;font-weight:bold');
    console.warn(r.error?.message || r.error);
    if (r.error?.detail) for (const d of r.error.detail) console.log('  ·', d);
    console.info(`💡 単体テスト: ${location.origin}/api/jepx?market=${r.key}`);
    console.info(`💡 全市場診断: ${location.origin}/api/jepx?diag=1`);
    console.groupEnd();
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

// 全市場分の sources を集約してヘッダピル用に整形:
// - 全部 live      → { state:'live',     ageSec: null }
// - 一部 snapshot  → { state:'snapshot', ageSec: 最古, liveCount, snapCount }
// - 全部 fail      → { state:'none' }
function summarizeSnapshotInfo(sources) {
  let live = 0, snap = 0, oldestAge = null;
  for (const k of Object.keys(sources)) {
    const s = sources[k];
    if (!s) continue;
    if (s.source === 'live') live += 1;
    else if (s.source === 'github-snapshot') {
      snap += 1;
      if (s.snapshotAgeSec != null && (oldestAge == null || s.snapshotAgeSec > oldestAge)) {
        oldestAge = s.snapshotAgeSec;
      }
    }
  }
  if (live + snap === 0) return { state: 'none' };
  if (snap === 0) return { state: 'live', liveCount: live, snapCount: 0, ageSec: null };
  return { state: 'snapshot', liveCount: live, snapCount: snap, ageSec: oldestAge };
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

// 3-b) TSO 需給は 5 分おき (denkiyoho の更新粒度)
loadTso();
setInterval(loadTso, 5 * 60 * 1000);

// 4) 奈良吉野太陽光発電所 (DEMO) は 5 秒ごとに再生成して常に値が動くように
setInterval(() => {
  try {
    const p = demoPlant();
    renderPlant(p);
    renderRevenue(demoRevenue(p, state.spot), p);
  } catch {}
}, 5000);
// 天気予報は 60 秒ごと (30 分コマなのでこの粒度で十分)
setInterval(() => { try { renderWeather(demoWeather()); } catch {} }, 60_000);

// タブが復帰した時にも更新
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    loadAll();
    loadTso();
  }
});
