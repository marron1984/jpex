// Vercel Edge Function — JEPX CSV プロキシ + 自動 URL 探索
//
// 2 モード:
//   /api/jepx?market=spot   ─ 5 市場のいずれかを指定。サーバ側が候補 URL を順次
//                              探索し、最初に 200 を返した CSV をそのまま中継する
//   /api/jepx?url=<JEPX>    ─ 旧モード (URL を明示的に指定)
//
// JEPX のドメイン (jepx.jp / jepx.org) 以外の URL は弾く。
// レスポンスヘッダ X-Source-Url に実際に取得できた URL を入れて、フロント側で
// 確認できるようにする。

export const config = { runtime: 'edge' };

const ALLOWED = /^https?:\/\/(www\.)?jepx\.(jp|org)\//i;

// 候補 URL 雛形。{YEAR} は西暦4桁、{FY} は会計年度 (4-3月)。
// 上から順に試行するので、最も最新で確実なパターンを上に置く。
const URL_PATTERNS = {
  spot: [
    'https://www.jepx.jp/market/excel/spot_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/spot_{YEAR_PREV}.csv',
    'https://www.jepx.jp/js/csv/spot_summary_{YEAR}.csv',
    'http://www.jepx.org/market/excel/spot_{YEAR}.csv',
  ],
  intraday: [
    'https://www.jepx.jp/market/excel/im_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/intraday_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/im_trade_summary_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/im_{YEAR_PREV}.csv',
    'https://www.jepx.jp/js/csv/im_trade_summary_{YEAR}.csv',
  ],
  forward: [
    'https://www.jepx.jp/market/excel/forward_{FY}.csv',
    'https://www.jepx.jp/market/excel/forward_{FY_PREV}.csv',
    'https://www.jepx.jp/market/excel/forward_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/forward_summary_{FY}.csv',
    'https://www.jepx.jp/js/csv/forward_summary_{FY}.csv',
  ],
  baseload: [
    'https://www.jepx.jp/market/excel/baseload_{FY}.csv',
    'https://www.jepx.jp/market/excel/baseload_{FY_PREV}.csv',
    'https://www.jepx.jp/market/excel/baseload_summary_{FY}.csv',
    'https://www.jepx.jp/market/excel/baseload_auction_{FY}.csv',
    'https://www.jepx.jp/js/csv/baseload_{FY}.csv',
  ],
  fip: [
    'https://www.jepx.jp/market/excel/fip_{FY}.csv',
    'https://www.jepx.jp/market/excel/fip_{FY_PREV}.csv',
    'https://www.jepx.jp/market/excel/fip_reference_{FY}.csv',
    'https://www.jepx.jp/market/excel/fip_{YEAR}.csv',
    'https://www.jepx.jp/js/csv/fip_summary_{FY}.csv',
  ],
};

function fiscalYear(d = new Date()) {
  const m = d.getMonth() + 1;
  const y = d.getFullYear();
  return m >= 4 ? y : y - 1;
}

function expand(pattern, now = new Date()) {
  const yr = now.getFullYear();
  const fy = fiscalYear(now);
  return pattern
    .replaceAll('{YEAR}',      String(yr))
    .replaceAll('{YEAR_PREV}', String(yr - 1))
    .replaceAll('{FY}',        String(fy))
    .replaceAll('{FY_PREV}',   String(fy - 1));
}

const FETCH_HEADERS = {
  // JEPX の WAF が空 UA 等を弾くケースに備えて一般的なブラウザ風 UA を付ける
  'User-Agent': 'Mozilla/5.0 (compatible; DENDENLIVE/1.0; +https://github.com/marron1984/jpex)',
  'Accept': 'text/csv, text/plain, application/octet-stream, */*',
  'Accept-Language': 'ja,en;q=0.8',
};

async function tryUrl(url) {
  try {
    const r = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      // Edge fetch にはタイムアウトが標準でないので AbortController で 8s
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { ok: false, status: r.status };
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 64) return { ok: false, status: 204, reason: 'too small' };
    return { ok: true, buf, contentType: r.headers.get('content-type') || 'text/csv' };
  } catch (e) {
    return { ok: false, status: 0, reason: e?.message || String(e) };
  }
}

export default async function handler(req) {
  const reqUrl = new URL(req.url);
  const market = reqUrl.searchParams.get('market');
  const explicitUrl = reqUrl.searchParams.get('url');

  // ─── ?market=… モード: 候補 URL を順次試行 ──────────────────
  if (market && URL_PATTERNS[market]) {
    const tried = [];
    for (const pat of URL_PATTERNS[market]) {
      const u = expand(pat);
      const res = await tryUrl(u);
      tried.push(`${u} → ${res.ok ? 'OK' : (res.status + (res.reason ? ` ${res.reason}` : ''))}`);
      if (res.ok) {
        return new Response(res.buf, {
          status: 200,
          headers: {
            'Content-Type': res.contentType,
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Source-Url, X-Tried',
            'X-Source-Url': u,
            'X-Tried': String(tried.length),
          },
        });
      }
    }
    return text(`No working URL for market=${market}\n\nTried:\n${tried.join('\n')}`, 502);
  }

  // ─── ?url=… モード: URL 直接指定 ──────────────────────────
  if (explicitUrl) {
    if (!ALLOWED.test(explicitUrl)) {
      return text('Only jepx.jp / jepx.org URLs are allowed', 400);
    }
    const res = await tryUrl(explicitUrl);
    if (!res.ok) {
      return text(`Upstream failed: ${res.status}${res.reason ? ' ' + res.reason : ''}`, res.status || 502);
    }
    return new Response(res.buf, {
      status: 200,
      headers: {
        'Content-Type': res.contentType,
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Source-Url',
        'X-Source-Url': explicitUrl,
      },
    });
  }

  // ─── 使い方 ────────────────────────────────────────────
  return text(
    `DENDENLIVE JEPX proxy

Usage:
  /api/jepx?market=spot       (also: intraday, forward, baseload, fip)
  /api/jepx?url=https://www.jepx.jp/market/excel/spot_2026.csv
`, 200);
}

function text(s, status = 200) {
  return new Response(s, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
