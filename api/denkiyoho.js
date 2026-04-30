// Vercel Edge Function — 各送配電会社の電力使用実績 (denkiyoho) CSV プロキシ。
//
// JEPX のスポット市場は server-side fetch を弾くケースが増えたので、ダッシュボードの
// 「実 LIVE」を担保するために 9 TSO の公開 CSV を一次ソースに据える。
//
// モード:
//   /api/denkiyoho                全 9 エリアの最新値を JSON で
//   /api/denkiyoho?area=tokyo     1 エリアだけ (シリーズ込み JSON)
//   /api/denkiyoho?probe=1        URL 試行ログだけを返す診断用
//
// 出典: 各 TSO の "電力使用状況/でんき予報" ページが公開する CSV。文字コードは
// Shift_JIS、レイアウトは TSO ごとにブレるが基本は「日付,時刻,実績(万kW)」。

export const config = { runtime: 'edge' };

function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; }

// 各 TSO の URL 候補。命名揺れに耐えるため複数並べ、先頭から順に試す。
// {YYYYMMDD} は当日 (YYYYMMDD)、{YYYY} は年。
const TSO_DEFS = {
  hokkaido: {
    label: '北海道',
    urls: [
      'https://denkiyoho.hepco.co.jp/area/data/juyo_01_{YYYYMMDD}.csv',
      'https://denkiyoho.hepco.co.jp/area/data/juyo_hokkaido.csv',
      'https://www.hepco.co.jp/network/con_service/public_document/juyo_01_{YYYYMMDD}.csv',
    ],
  },
  tohoku: {
    label: '東北',
    urls: [
      'https://setsuden.nw.tohoku-epco.co.jp/common/demand/juyo_02_{YYYYMMDD}.csv',
      'https://setsuden.nw.tohoku-epco.co.jp/common/demand/juyo_tohoku_{YYYYMMDD}.csv',
      'https://setsuden.nw.tohoku-epco.co.jp/common/demand/juyo_02.csv',
    ],
  },
  tokyo: {
    label: '東京',
    urls: [
      'https://www.tepco.co.jp/forecast/html/images/juyo-d-j.csv',
      'https://www.tepco.co.jp/forecast/html/images/juyo-{YYYY}.csv',
      'https://www.tepco.co.jp/forecast/html/images/juyo-d.csv',
    ],
  },
  chubu: {
    label: '中部',
    urls: [
      'https://powergrid.chuden.co.jp/denki_yoho_content_data/juyo_cepco003.csv',
      'https://powergrid.chuden.co.jp/denki_yoho_content_data/juyo_chubu.csv',
      'https://powergrid.chuden.co.jp/denki_yoho_content_data/juyo_cepco_{YYYYMMDD}.csv',
    ],
  },
  hokuriku: {
    label: '北陸',
    urls: [
      'https://www.rikuden.co.jp/nw/denki-yoho/csv/juyo_05_{YYYYMMDD}.csv',
      'https://www.rikuden.co.jp/nw/denki-yoho/csv/juyo_hokuriku.csv',
      'https://www.rikuden.co.jp/nw/denkiyoho/csv/juyo_05.csv',
    ],
  },
  kansai: {
    label: '関西',
    urls: [
      'https://www.kansai-td.co.jp/yamasou/juyo1_kansai.csv',
      'https://www.kansai-td.co.jp/yamasou/juyo_kansai.csv',
      'https://www.kansai-td.co.jp/denkiyoho/juyo_kansai.csv',
    ],
  },
  chugoku: {
    label: '中国',
    urls: [
      'https://www.energia.co.jp/nw/jukyuu/sys/juyo-j.csv',
      'https://www.energia.co.jp/nw/jukyuu/sys/juyo_chugoku.csv',
      'https://www.energia.co.jp/jukyuu/sys/juyo-j.csv',
    ],
  },
  shikoku: {
    label: '四国',
    urls: [
      'https://www.yonden.co.jp/nw/denkiyoho/juyo_shikoku.csv',
      'https://www.yonden.co.jp/nw/denkiyoho/juyo_07_{YYYYMMDD}.csv',
      'https://www.yonden.co.jp/denkiyoho/juyo_shikoku.csv',
    ],
  },
  kyushu: {
    label: '九州',
    urls: [
      'https://www.kyuden.co.jp/td_power_usages/csv/juyo-hourly-{YYYYMMDD}.csv',
      'https://www.kyuden.co.jp/td_power_usages/csv/juyo-kyushu.csv',
      'https://www.kyuden.co.jp/td_power_usages/csv/juyo_09_{YYYYMMDD}.csv',
    ],
  },
};

// 想定最大 (peak forecast) のレンジ目安 — 万kW。CSV から取れない時の fallback。
const APPROX_PEAK_MAN_KW = {
  hokkaido: 540, tohoku: 1380, tokyo: 5500, chubu: 2680,
  hokuriku: 540, kansai: 2900, chugoku: 1100, shikoku: 540, kyushu: 1620,
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; DENDENLIVE/1.1; +https://github.com/marron1984/jpex)',
  'Accept': 'text/csv,text/plain,*/*;q=0.5',
  'Accept-Language': 'ja,en;q=0.8',
  'Cache-Control': 'no-cache',
};

function expandUrl(p, now = new Date()) {
  return p
    .replaceAll('{YYYYMMDD}', ymd(now))
    .replaceAll('{YYYY}',     String(now.getFullYear()));
}

// Shift-JIS をフルセットでサポートする TextDecoder は Edge にも入っている。
// 文字化け率が閾値超なら shift_jis、そうでなければ utf-8 を採用。
function decodeBytes(buf) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const replCount = (utf8.match(/�/g) || []).length;
  if (replCount > 3) {
    try { return new TextDecoder('shift_jis').decode(buf); } catch { return utf8; }
  }
  return utf8;
}

// CSV → 行配列。区切り文字は , を想定。引用符は単純扱い。
function splitCsv(text) {
  return text.split(/\r?\n/).map(line => line.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
}

// "数字+カンマ区切り" を Number に。"4,521" → 4521、"4521" → 4521、空 → null。
function asNum(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[,\s　]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '－') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// 日時 → ISO 風文字列 (YYYY-MM-DD HH:MM)。失敗したら null。
function combineDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  // 日付: 2026/4/30 / 2026-04-30 / 2026/04/30
  const dm = String(dateStr).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!dm) return null;
  const date = `${dm[1]}-${pad2(dm[2])}-${pad2(dm[3])}`;
  let time = '00:00';
  if (timeStr) {
    const tm = String(timeStr).match(/(\d{1,2}):(\d{2})/);
    if (tm) time = `${pad2(tm[1])}:${tm[2]}`;
  }
  return `${date} ${time}`;
}

// CSV を読み、数値が立ち並ぶ「実績データ部」を抽出する寛容パーサ。
// 想定: 先頭にメタ行 (合計需要・想定最大・ピーク時供給力 等) → 空行 →
// "DATE,TIME,当日実績(万kW)" のヘッダ → データ行。
// レイアウトは TSO ごとに変わるので、純粋な「数字 + 数字 で 0..2000 万kW を満たす行」
// を実績とみなすヒューリスティック。
function parseTsoCsv(text, areaKey) {
  const rows = splitCsv(text);
  // メタ抽出: 最初の 30 行で「想定最大」「ピーク時供給力」「予想最大電力」を引く
  let peakForecast = null;
  let supplyCapacity = null;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const line = rows[i].join(',');
    if (peakForecast == null) {
      const m = line.match(/(?:予想最大|想定最大|想定ピーク).*?([\d,]+)\s*(?:万kW)?/);
      if (m) peakForecast = asNum(m[1]);
    }
    if (supplyCapacity == null) {
      const m = line.match(/(?:ピーク時供給力|供給力).*?([\d,]+)\s*(?:万kW)?/);
      if (m) supplyCapacity = asNum(m[1]);
    }
  }
  if (peakForecast == null) peakForecast = APPROX_PEAK_MAN_KW[areaKey] ?? null;
  if (supplyCapacity == null && peakForecast != null) supplyCapacity = Math.round(peakForecast * 1.06);

  // 実績データ部: 「YYYY/MM/DD,HH:MM,実績」または「DATE,TIME,実績,予測…」を拾う
  const series = [];
  for (const row of rows) {
    if (row.length < 3) continue;
    const ts = combineDateTime(row[0], row[1]);
    if (!ts) continue;
    const actual = asNum(row[2]);
    const forecast = row.length > 3 ? asNum(row[3]) : null;
    if (actual == null && forecast == null) continue;
    series.push({ ts, actual, forecast });
  }
  // 末尾から「actualが入っている最後の行」を current とする
  let current = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].actual != null) { current = series[i]; break; }
  }
  return {
    peakForecast,
    supplyCapacity,
    current,
    seriesLength: series.length,
    series,
  };
}

async function tryUrl(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - t0;
    if (!r.ok) return { ok: false, status: r.status, ms };
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 64) return { ok: false, status: 204, reason: 'too small', bytes: buf.byteLength, ms };
    return { ok: true, status: r.status, buf, bytes: buf.byteLength, ms };
  } catch (e) {
    return { ok: false, status: 0, reason: e?.message || String(e), ms: Date.now() - t0 };
  }
}

async function fetchArea(areaKey, opts = {}) {
  const def = TSO_DEFS[areaKey];
  if (!def) return { ok: false, reason: 'unknown area' };
  const tried = [];
  for (const pat of def.urls) {
    const u = expandUrl(pat);
    const r = await tryUrl(u);
    tried.push({ url: u, ok: r.ok, status: r.status, reason: r.reason || null, bytes: r.bytes || 0, ms: r.ms });
    if (!r.ok) continue;
    const text = decodeBytes(r.buf);
    const parsed = parseTsoCsv(text, areaKey);
    if (parsed.current && parsed.current.actual != null) {
      return { ok: true, sourceUrl: u, label: def.label, ...parsed, tried };
    }
    tried[tried.length - 1].reason = 'parsed but no current actual';
  }
  return { ok: false, label: def.label, tried };
}

export default async function handler(req) {
  const reqUrl = new URL(req.url);
  const area = reqUrl.searchParams.get('area');
  const probe = reqUrl.searchParams.get('probe');

  // ?area=X — 単一エリア (シリーズ込み)
  if (area && TSO_DEFS[area]) {
    const out = await fetchArea(area);
    return jsonResponse({ area, label: TSO_DEFS[area].label, ...out }, out.ok ? 200 : 502);
  }

  // ?probe=1 — 全エリアの試行ログのみ (CSV body は含まない)
  // 全エリア (デフォルト): 全部並列で走らせて current だけ集める
  const areas = Object.keys(TSO_DEFS);
  const results = await Promise.all(areas.map(async (a) => {
    const r = await fetchArea(a);
    if (!r.ok) {
      return [a, {
        ok: false,
        label: TSO_DEFS[a].label,
        attempts: r.tried?.length || 0,
        lastError: r.tried?.find(t => !t.ok)?.reason || `status ${r.tried?.find(t => !t.ok)?.status}`,
      }];
    }
    const utilization = r.peakForecast ? (r.current.actual / r.peakForecast) * 100 : null;
    const supplyMargin = r.supplyCapacity ? ((r.supplyCapacity - r.current.actual) / r.supplyCapacity) * 100 : null;
    // 1 時間前比 / 24 時間前比
    const last = r.series[r.series.length - 1];
    const idxNow = r.series.indexOf(r.current);
    const oneHrAgo = idxNow >= 12 ? r.series[idxNow - 12] : null;  // 5min × 12 = 1h
    const oneHrPct = oneHrAgo?.actual ? ((r.current.actual - oneHrAgo.actual) / oneHrAgo.actual) * 100 : null;
    return [a, {
      ok: true,
      label: r.label,
      sourceUrl: r.sourceUrl,
      currentMw: r.current.actual * 10,           // 万kW → MW
      currentTs: r.current.ts,
      forecastMw: r.current.forecast != null ? r.current.forecast * 10 : null,
      peakForecastMw: r.peakForecast != null ? r.peakForecast * 10 : null,
      supplyCapacityMw: r.supplyCapacity != null ? r.supplyCapacity * 10 : null,
      utilizationPct: utilization,
      supplyMarginPct: supplyMargin,
      oneHrDeltaPct: oneHrPct,
      seriesLength: r.seriesLength,
      // 24h 範囲のミニ系列だけ返す (帯域節約)。最後の 96 サンプル ≒ 8h or 24h。
      mini: probe ? null : r.series.slice(-96).map(p => ({
        ts: p.ts,
        mw: p.actual != null ? p.actual * 10 : null,
      })),
    }];
  }));

  return jsonResponse({
    now: new Date().toISOString(),
    areas: Object.fromEntries(results),
  });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      // TSO は 5 分粒度なので CDN でも 60 秒だけ
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
    },
  });
}
