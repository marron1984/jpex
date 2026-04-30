// Vercel Edge Function — 気象庁 (JMA) bosai 予報 API プロキシ。
//
// 奈良県 (290000) の forecast JSON を取得し、奈良吉野太陽光発電所がある南部 (290020) の
// 天気コード・気温予報・週間予報を抽出してフロント向けに整形する。
//
//   /api/jma                    奈良県 (デフォルト) の整形済 JSON
//   /api/jma?pref=130000        他都道府県コード指定 (東京 130000 等)
//   /api/jma?raw=1              JMA から取れた生 JSON をそのまま返す (デバッグ)

export const config = { runtime: 'edge' };

const DEFAULT_PREF = '290000';   // 奈良県
const DEFAULT_AREA = '290020';   // 奈良県南部 (吉野郡)

// JMA の weatherCode (3 桁) → 内部 7 段階の天気区分 + アイコン
// 公式コード表: https://www.jma.go.jp/bosai/forecast/const/weatherCode.json
const WEATHER_CONDITIONS = [
  { key: 'sunny',         icon: '☀️', label: '晴',         color: '#fbbf24', solarMul: 1.00, cloudPct: 5  },
  { key: 'mostly-sunny',  icon: '🌤', label: '晴時々曇',   color: '#facc15', solarMul: 0.85, cloudPct: 30 },
  { key: 'partly-cloudy', icon: '⛅',  label: '曇時々晴',   color: '#cbd5e1', solarMul: 0.65, cloudPct: 55 },
  { key: 'cloudy',        icon: '☁️', label: '曇',         color: '#94a3b8', solarMul: 0.40, cloudPct: 80 },
  { key: 'light-rain',    icon: '🌦', label: '小雨',       color: '#7dd3fc', solarMul: 0.25, cloudPct: 90 },
  { key: 'rain',          icon: '🌧', label: '雨',         color: '#38bdf8', solarMul: 0.15, cloudPct: 95 },
  { key: 'storm',         icon: '⛈',  label: '雷雨',       color: '#a78bfa', solarMul: 0.08, cloudPct: 99 },
];

// JMA コード → 内部区分インデックス。代表値だけ網羅し、未登録コードは prefix で推定。
function jmaCodeToIndex(code) {
  const c = String(code || '').trim();
  if (!c) return 3; // 不明 → 曇
  // 雷雨系
  if (/^(2..|3..|4..)$/.test(c) && /雷/.test(c)) return 6;
  // 100台 = 晴
  if (c.startsWith('1')) {
    if (c === '100' || c === '123' || c === '124') return 0;
    if (/^10[1-3]$/.test(c) || c === '110' || c === '111') return 1;
    if (/^11[2-9]$/.test(c) || c === '120' || c === '121' || c === '122') return 2;
    return 1;
  }
  // 200台 = 曇
  if (c.startsWith('2')) {
    if (c === '200' || c === '209') return 3;
    if (/^20[1-3]$/.test(c) || /^21[0-1]$/.test(c)) return 2;
    if (/^21[2-9]$/.test(c) || /^22[0-9]$/.test(c)) return 4;
    return 3;
  }
  // 300台 = 雨
  if (c.startsWith('3')) {
    if (/^30[0-1]$/.test(c) || /^31[0-9]$/.test(c) || /^32[0-9]$/.test(c)) return 5;
    if (c === '302' || c === '311' || c === '313' || c === '314') return 4;
    if (c === '306' || c === '308' || c === '320' || c === '321' || c === '322' || c === '323') return 5;
    if (c === '328' || c === '329' || /^35[0-9]$/.test(c)) return 6;
    return 5;
  }
  // 400台 = 雪
  if (c.startsWith('4')) return 5;
  return 3;
}

function pickArea(timeSeries, areaCode) {
  if (!timeSeries) return null;
  const a = timeSeries.areas?.find(x => x.area?.code === areaCode);
  return a || timeSeries.areas?.[0] || null;
}

function parse(raw, areaCode = DEFAULT_AREA) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const today = raw[0];
  const week  = raw[1];

  // 短期予報 timeSeries[0]: weatherCodes / weathers
  const tsWeather = today?.timeSeries?.[0];
  const tsTemp    = today?.timeSeries?.[2];

  const aw = pickArea(tsWeather, areaCode);
  const at = pickArea(tsTemp, areaCode);

  // 週間予報 timeSeries[1]: tempsMin / tempsMax
  const wkWeather = week?.timeSeries?.[0];
  const wkTemps   = week?.timeSeries?.[1];

  // 短期 weatherCodes 配列を timeDefines で対応付け
  const slices = [];
  if (tsWeather && aw && Array.isArray(aw.weatherCodes)) {
    tsWeather.timeDefines?.forEach((t, i) => {
      const code = aw.weatherCodes[i];
      slices.push({
        ts: t,
        code,
        text: aw.weathers?.[i] || '',
        idx: jmaCodeToIndex(code),
        cond: WEATHER_CONDITIONS[jmaCodeToIndex(code)],
      });
    });
  }

  // 当日の min/max temp (timeDefines が朝/夕で min/max 順のことが多い)
  let todayMin = null, todayMax = null;
  if (at && Array.isArray(at.tempsMin) && Array.isArray(at.tempsMax)) {
    todayMin = at.tempsMin.find(v => v !== '') ?? null;
    todayMax = at.tempsMax.find(v => v !== '') ?? null;
  } else if (at && Array.isArray(at.temps)) {
    // 旧仕様: ["13", "23"] = [min, max]
    const nums = at.temps.filter(v => v !== '').map(Number).filter(Number.isFinite);
    if (nums.length >= 2) { todayMin = nums[0]; todayMax = nums[1]; }
  }

  // 週間 (5-7 日)
  const wkArea  = pickArea(wkWeather, areaCode);
  const wkTArea = pickArea(wkTemps, '290010') || pickArea(wkTemps, areaCode);
  const weekly = [];
  if (wkWeather && wkArea && Array.isArray(wkArea.weatherCodes)) {
    wkWeather.timeDefines?.forEach((t, i) => {
      const code = wkArea.weatherCodes[i];
      weekly.push({
        date: t.slice(0, 10),
        code,
        idx: jmaCodeToIndex(code),
        cond: WEATHER_CONDITIONS[jmaCodeToIndex(code)],
        max: wkTArea?.tempsMax?.[i] ? Number(wkTArea.tempsMax[i]) : null,
        min: wkTArea?.tempsMin?.[i] ? Number(wkTArea.tempsMin[i]) : null,
      });
    });
  }

  return {
    publishingOffice: today?.publishingOffice || '',
    reportDatetime:   today?.reportDatetime || '',
    area: { code: areaCode, name: aw?.area?.name || '' },
    todayMin: todayMin != null ? Number(todayMin) : null,
    todayMax: todayMax != null ? Number(todayMax) : null,
    slices,
    weekly,
  };
}

export default async function handler(req) {
  const reqUrl = new URL(req.url);
  const pref = reqUrl.searchParams.get('pref') || DEFAULT_PREF;
  const area = reqUrl.searchParams.get('area') || DEFAULT_AREA;
  const raw  = reqUrl.searchParams.get('raw');
  const url = `https://www.jma.go.jp/bosai/forecast/data/forecast/${encodeURIComponent(pref)}.json`;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json', 'User-Agent': 'DENDENLIVE/1.1 (+https://github.com/marron1984/jpex)' },
    });
    if (!r.ok) return jsonResponse({ error: `JMA HTTP ${r.status}`, source: url }, 502);
    const data = await r.json();
    if (raw) return jsonResponse(data);
    const parsed = parse(data, area);
    if (!parsed) return jsonResponse({ error: 'parse failed', source: url }, 502);
    return jsonResponse({ source: url, ...parsed });
  } catch (e) {
    return jsonResponse({ error: e?.message || String(e), source: url }, 502);
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      // JMA は 1 時間ごとに更新されるので CDN で 5 分キャッシュ
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
