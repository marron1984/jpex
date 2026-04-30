// 天気予報データ層: 気象庁 (JMA) bosai 予報 API → 30 分粒度 24h ストリップ。
//
// /api/jma が奈良県南部 (吉野郡) の slices (短期予報の 6 時間粒度) と
// 当日 min/max を返す。これを 30 分 × 48 コマに線形補間 + 日射係数で
// 太陽光出力予測 (kW) を算出。
//
// JMA 取得失敗時は demoWeather() に gracefully フォールバック。

const WEATHER_CONDITIONS = [
  { key: 'sunny',         icon: '☀️', label: '晴',         color: '#fbbf24', solarMul: 1.00, cloudPct: 5  },
  { key: 'mostly-sunny',  icon: '🌤', label: '晴時々曇',   color: '#facc15', solarMul: 0.85, cloudPct: 30 },
  { key: 'partly-cloudy', icon: '⛅',  label: '曇時々晴',   color: '#cbd5e1', solarMul: 0.65, cloudPct: 55 },
  { key: 'cloudy',        icon: '☁️', label: '曇',         color: '#94a3b8', solarMul: 0.40, cloudPct: 80 },
  { key: 'light-rain',    icon: '🌦', label: '小雨',       color: '#7dd3fc', solarMul: 0.25, cloudPct: 90 },
  { key: 'rain',          icon: '🌧', label: '雨',         color: '#38bdf8', solarMul: 0.15, cloudPct: 95 },
  { key: 'storm',         icon: '⛈',  label: '雷雨',       color: '#a78bfa', solarMul: 0.08, cloudPct: 99 },
];

const PLANT_CAPACITY_KW = 2000;   // 奈良吉野太陽光発電所 2.0 MW

// 太陽光出力係数 0..1 — plant.js と同じ式 (春先〜初夏)
function solarFactor(hour, minute = 0, cloudMul = 1.0) {
  const t = hour + minute / 60;
  const SUNRISE = 5.2, SUNSET = 18.8;
  if (t < SUNRISE || t > SUNSET) return 0;
  const peak = (SUNRISE + SUNSET) / 2;
  const halfDay = (SUNSET - SUNRISE) / 2;
  const angle = ((t - peak) / halfDay) * (Math.PI / 2);
  const insolation = Math.cos(angle);
  if (insolation <= 0) return 0;
  return Math.max(0, Math.min(0.96, Math.pow(insolation, 1.4) * 0.85 * cloudMul));
}

// 24h 内で当該時刻の slice を引く (slice 配列は日付混在の可能性あり)
function pickSliceForHour(slices, target) {
  if (!slices || !slices.length) return null;
  const tMs = target.getTime();
  // target に最も近く、かつ「target 以前」の slice を選ぶ (forecast の表現方法に合わせる)
  let best = null;
  let bestDiff = Infinity;
  for (const s of slices) {
    const sliceMs = new Date(s.ts).getTime();
    if (Number.isNaN(sliceMs)) continue;
    const diff = tMs - sliceMs;
    if (diff < 0) continue;
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  // 全部未来なら一番早いやつ
  if (!best) {
    for (const s of slices) {
      const sliceMs = new Date(s.ts).getTime();
      if (Number.isNaN(sliceMs)) continue;
      const diff = sliceMs - tMs;
      if (diff < bestDiff) { bestDiff = diff; best = s; }
    }
  }
  return best;
}

function buildStripFromJma(jma) {
  const now = new Date();
  // 30 分単位に切り上げ (= 直前のスロット)
  const start = new Date(Math.ceil(now.getTime() / (30 * 60 * 1000)) * 30 * 60 * 1000 - 30 * 60 * 1000);
  const min = jma.todayMin != null ? jma.todayMin : 12;
  const max = jma.todayMax != null ? jma.todayMax : 22;

  const slots = [];
  for (let i = 0; i < 48; i++) {
    const t = new Date(start.getTime() + i * 30 * 60 * 1000);
    const slice = pickSliceForHour(jma.slices, t);
    const condIdx = slice?.idx ?? 1;
    const cond = WEATHER_CONDITIONS[condIdx] || WEATHER_CONDITIONS[1];

    // 気温: min(5:00) ↔ max(14:00) を sin で補間
    const h = t.getHours() + t.getMinutes() / 60;
    // 日中ピークが 14h、最低が 5h と仮定
    const phase = ((h - 5) / 24) * Math.PI * 2; // 5h で 0, 14h で π/2 付近
    const tempBase = (min + max) / 2 + ((max - min) / 2) * Math.sin(phase);
    const tempAdj = (cond.key === 'rain' || cond.key === 'storm') ? -2 : 0;
    const temp = Math.round((tempBase + tempAdj) * 10) / 10;

    const factor = solarFactor(t.getHours(), t.getMinutes(), cond.solarMul);
    const expectedKw = Math.round(PLANT_CAPACITY_KW * factor);

    slots.push({
      time: t,
      timeStr: `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`,
      condition: cond,
      temp,
      cloudPct: cond.cloudPct,
      expectedKw,
      isNow: i === 0,
      isLive: true,
    });
  }
  return { slots, source: jma.source, area: jma.area, reportDatetime: jma.reportDatetime, weekly: jma.weekly };
}

let _cached = null;     // 直近成功した JMA 整形済データ
let _cachedAt = 0;
const CACHE_MS = 10 * 60 * 1000;

export async function fetchWeather({ signal } = {}) {
  // メモリキャッシュ (10 分)。タブ復帰や render 連打で叩きすぎないため。
  const now = Date.now();
  if (_cached && now - _cachedAt < CACHE_MS) {
    return { isLive: true, ...buildStripFromJma(_cached) };
  }
  try {
    const r = await fetch('/api/jma', { signal, cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    if (json.error || !json.slices) throw new Error(json.error || 'no slices');
    _cached = json;
    _cachedAt = now;
    return { isLive: true, ...buildStripFromJma(json) };
  } catch (e) {
    return { isLive: false, error: e?.message || String(e), slots: null };
  }
}

// 直前の cache をそのまま再描画用に返す (JMA 失敗 → demo へ落とした後でも、
// 旧 cache がある間はそれを使い続けたいケース用)。
export function lastCachedWeather() {
  if (_cached) return { isLive: true, ...buildStripFromJma(_cached) };
  return null;
}
