// 9 TSO (送配電会社) の電力使用実績を /api/denkiyoho から取りに行き、
// 失敗エリアは合成データでフォールバックする。
//
// 戻り値スキーマ:
// {
//   updatedAt: number,
//   isLive: boolean,
//   areas: {
//     hokkaido: {
//       label, currentMw, peakForecastMw, supplyCapacityMw,
//       utilizationPct, supplyMarginPct, oneHrDeltaPct, mini: [{ts, mw}, ...],
//       sourceUrl, isLive,
//     },
//     ...
//   }
// }

const TSO_LABELS = {
  hokkaido: '北海道', tohoku: '東北',     tokyo:    '東京',
  chubu:    '中部',   hokuriku: '北陸',   kansai:   '関西',
  chugoku:  '中国',   shikoku:  '四国',   kyushu:   '九州',
};

// 想定最大 (peak forecast) の概算 (MW)。LIVE が取れなかった時の合成用。
const APPROX_PEAK_MW = {
  hokkaido: 5_400, tohoku: 13_800, tokyo: 55_000, chubu: 26_800,
  hokuriku: 5_400, kansai: 29_000, chugoku: 11_000, shikoku: 5_400, kyushu: 16_200,
};

// 24h の典型需要曲線 (peak 比率 0..1)。早朝 0.55 → 朝 0.85 → 昼 0.78 → 夕 0.95 → 夜 0.65。
function syntheticDemandFactor(hour, minute = 0) {
  const t = hour + minute / 60;
  // 二山型。朝 8h 付近、夕 18-19h 付近にピーク
  const base = 0.55;
  const morning = Math.exp(-Math.pow((t - 9.5)  / 3.5, 2)) * 0.30;
  const evening = Math.exp(-Math.pow((t - 18.5) / 2.4, 2)) * 0.40;
  const noonDip = -Math.exp(-Math.pow((t - 13.0) / 2.0, 2)) * 0.05;
  const night   = -Math.exp(-Math.pow((t - 3.5)  / 2.0, 2)) * 0.18;
  return Math.max(0.30, Math.min(0.99, base + morning + evening + noonDip + night));
}

function syntheticArea(areaKey) {
  const peak = APPROX_PEAK_MW[areaKey];
  const now = new Date();
  const factor = syntheticDemandFactor(now.getHours(), now.getMinutes());
  const noise = (Math.sin(now.getMinutes() * 0.3 + areaKey.length) * 0.015);
  const utilization = Math.max(0.30, Math.min(0.99, factor + noise));
  const currentMw = Math.round(peak * utilization);
  const supplyCap = Math.round(peak * 1.06);
  const supplyMargin = ((supplyCap - currentMw) / supplyCap) * 100;
  // mini: 直近 96 サンプル (5分間隔 → 8h)
  const mini = [];
  for (let i = 95; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 5 * 60 * 1000);
    const f = syntheticDemandFactor(t.getHours(), t.getMinutes());
    const n = Math.sin(i * 0.21 + areaKey.length * 0.7) * 0.012;
    mini.push({
      ts: `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`,
      mw: Math.round(peak * Math.max(0.25, f + n)),
    });
  }
  // 1h 前比
  const oneHrAgo = mini[mini.length - 12]?.mw ?? null;
  const oneHrDeltaPct = oneHrAgo ? ((currentMw - oneHrAgo) / oneHrAgo) * 100 : null;
  return {
    label: TSO_LABELS[areaKey],
    currentMw,
    forecastMw: null,
    peakForecastMw: peak,
    supplyCapacityMw: supplyCap,
    utilizationPct: utilization * 100,
    supplyMarginPct: supplyMargin,
    oneHrDeltaPct,
    mini,
    isLive: false,
    sourceUrl: null,
  };
}

export function buildSyntheticTso() {
  const areas = {};
  for (const k of Object.keys(TSO_LABELS)) areas[k] = syntheticArea(k);
  return { updatedAt: Date.now(), isLive: false, areas };
}

export async function fetchTso({ signal } = {}) {
  try {
    const r = await fetch('/api/denkiyoho', { cache: 'no-cache', signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    const out = { updatedAt: Date.now(), isLive: false, areas: {} };
    let liveCount = 0;
    for (const k of Object.keys(TSO_LABELS)) {
      const live = json.areas?.[k];
      if (live?.ok) {
        out.areas[k] = {
          label: live.label || TSO_LABELS[k],
          currentMw: live.currentMw,
          forecastMw: live.forecastMw,
          peakForecastMw: live.peakForecastMw,
          supplyCapacityMw: live.supplyCapacityMw,
          utilizationPct: live.utilizationPct,
          supplyMarginPct: live.supplyMarginPct,
          oneHrDeltaPct: live.oneHrDeltaPct,
          mini: Array.isArray(live.mini) ? live.mini : [],
          isLive: true,
          sourceUrl: live.sourceUrl || null,
        };
        liveCount += 1;
      } else {
        out.areas[k] = syntheticArea(k);
      }
    }
    out.isLive = liveCount > 0;
    out.liveCount = liveCount;
    return out;
  } catch (e) {
    const fallback = buildSyntheticTso();
    fallback.error = e?.message || String(e);
    return fallback;
  }
}

export const TSO_AREA_KEYS = Object.keys(TSO_LABELS);
