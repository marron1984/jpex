// Vercel Edge Function — JEPX CSV プロキシ + 自動 URL 探索 + 構造化エラー
//
// モード:
//   /api/jepx?market=spot           市場別の CSV (バイナリ中継)
//   /api/jepx?market=spot&probe=1   その市場の試行ログのみ JSON (CSV は返さない)
//   /api/jepx?diag=1                全 5 市場の試行結果を 1 つの JSON で
//   /api/jepx?url=<jepx-url>        URL を明示指定して中継
//
// 失敗時のフォールバック:
//   LIVE 取得が全滅したら GitHub Pages 経由のスナップショット
//   (raw.githubusercontent.com/marron1984/jpex/<branch>/data/<market>.csv) を返す。
//   X-Source: github-snapshot, X-Snapshot-Age-Seconds: ... を付ける。
//   GitHub Actions の cron (.github/workflows/scrape-jepx.yml) が 30 分おきに
//   data/*.csv を更新する。

export const config = { runtime: 'edge' };

// スナップショット取得元 (CI が更新するブランチ)
const SNAPSHOT_REPO   = 'marron1984/jpex';
const SNAPSHOT_BRANCH = 'claude/japan-power-market-display-6Nk9g';
const SNAPSHOT_BASE   = `https://raw.githubusercontent.com/${SNAPSHOT_REPO}/${SNAPSHOT_BRANCH}/data`;

const ALLOWED = /^https?:\/\/(www\.)?jepx\.(jp|org)\//i;

// 公式の市場データページ — 固定 URL で取れなかった時にスクレイプする対象
const MARKET_PAGES = {
  spot:     'https://www.jepx.jp/electricpower/market-data/spot/',
  intraday: 'https://www.jepx.jp/electricpower/market-data/intraday/',
  forward:  'https://www.jepx.jp/electricpower/market-data/forward/',
  baseload: 'https://www.jepx.jp/electricpower/market-data/baseload/',
  fip:      'https://www.jepx.jp/electricpower/market-data/fit_fip/',
};

// HTML 中の CSV リンクを引っ張り出す正規表現
const CSV_HREF_RE = /(?:href|src|data-href|data-url|data-file|url)\s*=\s*["']([^"']+\.csv[^"']*)["']/gi;
const CSV_BARE_RE = /https?:\/\/(?:www\.)?jepx\.(?:jp|org)\/[^\s"'<>)\]]+\.csv/gi;
// JS リテラル中の "filename.csv" パターン (data attr, JSON config 等)
const CSV_LITERAL_RE = /["']([^"'<>]*?\/[^"'<>\/]+\.csv)["']/gi;

// 候補 URL 雛形 (上から順、ヒットしたら採用)
const URL_PATTERNS = {
  spot: [
    'https://www.jepx.jp/market/excel/spot_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/spot_{YEAR_PREV}.csv',
    'https://www.jepx.jp/market/excel/spot_summary_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/spot_summary_{YEAR_PREV}.csv',
    'https://www.jepx.jp/js/csv/spot_summary_{YEAR}.csv',
    'https://www.jepx.jp/js/csv/spot_summary_{YEAR_PREV}.csv',
    'https://www.jepx.jp/js/csv/spot_{YEAR}.csv',
    'https://www.jepx.jp/js/csv/spot_{YEAR_PREV}.csv',
    'http://www.jepx.org/market/excel/spot_{YEAR}.csv',
    'http://www.jepx.org/market/excel/spot_{YEAR_PREV}.csv',
  ],
  intraday: [
    'https://www.jepx.jp/market/excel/im_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/im_{YEAR_PREV}.csv',
    'https://www.jepx.jp/market/excel/intraday_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/intraday_{YEAR_PREV}.csv',
    'https://www.jepx.jp/market/excel/im_trade_summary_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/im_trade_summary_{YEAR_PREV}.csv',
    'https://www.jepx.jp/js/csv/im_trade_summary_{YEAR}.csv',
    'https://www.jepx.jp/js/csv/im_trade_summary_{YEAR_PREV}.csv',
    'https://www.jepx.jp/js/csv/im_{YEAR}.csv',
  ],
  forward: [
    'https://www.jepx.jp/market/excel/forward_{FY}.csv',
    'https://www.jepx.jp/market/excel/forward_{FY_PREV}.csv',
    'https://www.jepx.jp/market/excel/forward_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/forward_{YEAR_PREV}.csv',
    'https://www.jepx.jp/market/excel/forward_summary_{FY}.csv',
    'https://www.jepx.jp/market/excel/forward_summary_{FY_PREV}.csv',
    'https://www.jepx.jp/js/csv/forward_summary_{FY}.csv',
    'https://www.jepx.jp/js/csv/forward_summary_{FY_PREV}.csv',
  ],
  baseload: [
    'https://www.jepx.jp/market/excel/baseload_{FY}.csv',
    'https://www.jepx.jp/market/excel/baseload_{FY_PREV}.csv',
    'https://www.jepx.jp/market/excel/baseload_summary_{FY}.csv',
    'https://www.jepx.jp/market/excel/baseload_summary_{FY_PREV}.csv',
    'https://www.jepx.jp/market/excel/baseload_auction_{FY}.csv',
    'https://www.jepx.jp/market/excel/baseload_auction_{FY_PREV}.csv',
    'https://www.jepx.jp/js/csv/baseload_{FY}.csv',
    'https://www.jepx.jp/js/csv/baseload_{FY_PREV}.csv',
  ],
  fip: [
    'https://www.jepx.jp/market/excel/fip_{FY}.csv',
    'https://www.jepx.jp/market/excel/fip_{FY_PREV}.csv',
    'https://www.jepx.jp/market/excel/fip_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/fip_{YEAR_PREV}.csv',
    'https://www.jepx.jp/market/excel/fip_reference_{FY}.csv',
    'https://www.jepx.jp/market/excel/fip_reference_{FY_PREV}.csv',
    'https://www.jepx.jp/js/csv/fip_summary_{FY}.csv',
    'https://www.jepx.jp/js/csv/fip_summary_{FY_PREV}.csv',
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
  'User-Agent': 'Mozilla/5.0 (compatible; DENDENLIVE/1.0; +https://github.com/marron1984/jpex)',
  'Accept': 'text/csv, text/plain, application/octet-stream, */*',
  'Accept-Language': 'ja,en;q=0.8',
};

// JEPX は CSV が無い URL でも 200 で landing/エラーページ HTML を返すことがある。
// content-type と先頭バイトで CSV か否かを判別する。
function isLikelyCsv(buf, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.startsWith('text/html')) return false;
  const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 512));
  if (/^\s*<\!?(?:doctype|html)/i.test(head)) return false;
  if (/<\s*(html|body|head|meta|script)\b/i.test(head)) return false;
  return /[,\n]/.test(head);
}

async function tryUrl(url, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { ok: false, status: r.status, ms };
    const ct = r.headers.get('content-type') || 'text/csv';
    if (opts.headOnly) {
      // HEAD 風モード (バイト無し): content-type で text/html を弾く
      if (ct.toLowerCase().startsWith('text/html')) return { ok: false, status: 200, reason: 'html landing', ms };
      return { ok: true, status: r.status, ms, contentType: ct };
    }
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 64) return { ok: false, status: 204, reason: 'too small', bytes: buf.byteLength, ms };
    if (!isLikelyCsv(buf, ct))  return { ok: false, status: 200,  reason: 'html landing (not csv)', bytes: buf.byteLength, ms };
    return { ok: true, status: r.status, buf, contentType: ct, bytes: buf.byteLength, ms };
  } catch (e) {
    return { ok: false, status: 0, reason: e?.message || String(e), ms: Date.now() - t0 };
  }
}

async function scrapeMarketLinks(marketKey) {
  const pageUrl = MARKET_PAGES[marketKey];
  if (!pageUrl) return { pageUrl: null, links: [], error: 'no page' };
  try {
    const r = await fetch(pageUrl, {
      headers: { ...FETCH_HEADERS, 'Accept': 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { pageUrl, links: [], error: `page status ${r.status}` };
    const html = await r.text();
    const set = new Set();
    let m;
    CSV_HREF_RE.lastIndex = 0;
    while ((m = CSV_HREF_RE.exec(html))) set.add(absoluteUrl(m[1], pageUrl));
    CSV_BARE_RE.lastIndex = 0;
    while ((m = CSV_BARE_RE.exec(html))) set.add(m[0]);
    CSV_LITERAL_RE.lastIndex = 0;
    while ((m = CSV_LITERAL_RE.exec(html))) {
      const u = absoluteUrl(m[1], pageUrl);
      if (ALLOWED.test(u)) set.add(u);
    }
    return { pageUrl, links: [...set] };
  } catch (e) {
    return { pageUrl, links: [], error: e?.message || String(e) };
  }
}

function rankByYear(urls) {
  const yr = new Date().getFullYear();
  return [...urls].sort((a, b) => {
    const ay = (a.match(/(\d{4})/) || [, 0])[1] | 0;
    const by = (b.match(/(\d{4})/) || [, 0])[1] | 0;
    return Math.abs(yr - ay) - Math.abs(yr - by);
  });
}

async function probeMarket(marketKey, headOnly = false) {
  const tried = [];

  // (a) パターン
  for (const pat of URL_PATTERNS[marketKey] || []) {
    const u = expand(pat);
    const r = await tryUrl(u, { headOnly });
    tried.push({ via: 'pattern', url: u, ok: r.ok, status: r.status, reason: r.reason || null, bytes: r.bytes || 0, ms: r.ms });
    if (r.ok && !headOnly) return { result: 'ok', url: u, via: 'pattern', buf: r.buf, contentType: r.contentType, tried };
    if (r.ok && headOnly) return { result: 'ok', url: u, via: 'pattern', tried };
  }

  // (b) ページスクレイプ
  const { pageUrl, links, error: scrapeErr } = await scrapeMarketLinks(marketKey);
  if (scrapeErr) tried.push({ via: 'scrape', url: pageUrl || 'n/a', ok: false, status: 0, reason: scrapeErr });

  for (const u of rankByYear(links).slice(0, 10)) {
    if (!ALLOWED.test(u)) continue;
    const r = await tryUrl(u, { headOnly });
    tried.push({ via: 'scrape', url: u, ok: r.ok, status: r.status, reason: r.reason || null, bytes: r.bytes || 0, ms: r.ms });
    if (r.ok && !headOnly) return { result: 'ok', url: u, via: 'scrape', buf: r.buf, contentType: r.contentType, tried };
    if (r.ok && headOnly) return { result: 'ok', url: u, via: 'scrape', tried };
  }

  return { result: 'fail', tried, scrapedLinks: links };
}

export default async function handler(req) {
  const reqUrl = new URL(req.url);
  const market = reqUrl.searchParams.get('market');
  const probe  = reqUrl.searchParams.get('probe');
  const diag   = reqUrl.searchParams.get('diag');
  const explicitUrl = reqUrl.searchParams.get('url');

  // ─── ?diag=1: 全市場を probe ──────────────────────────────
  if (diag) {
    const markets = Object.keys(URL_PATTERNS);
    const [marketResults, snapshotMeta] = await Promise.all([
      Promise.all(markets.map(async (m) => {
        const out = await probeMarket(m, true);  // headOnly=true で軽量
        return [m, { result: out.result, url: out.url || null, via: out.via || null, tried: out.tried, scrapedLinks: out.scrapedLinks?.slice(0, 20) || [] }];
      })),
      fetchSnapshotMeta(),
    ]);
    return jsonResponse({
      now: new Date().toISOString(),
      markets: Object.fromEntries(marketResults),
      snapshot: snapshotMeta,
    });
  }

  // ─── ?probe=1&market=X: 単一市場を probe ──────────────────
  if (probe && market && URL_PATTERNS[market]) {
    const out = await probeMarket(market, true);
    return jsonResponse({ market, ...out, scrapedLinks: out.scrapedLinks?.slice(0, 20) });
  }

  // ─── ?market=X: 中継 ──────────────────────────────────────
  if (market && URL_PATTERNS[market]) {
    const out = await probeMarket(market, false);
    if (out.result === 'ok') {
      return new Response(out.buf, {
        status: 200,
        headers: {
          'Content-Type': out.contentType,
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Source-Url, X-Via, X-Tried, X-Source, X-Snapshot-Age-Seconds, X-Snapshot-At',
          'X-Source-Url': out.url,
          'X-Via': out.via,
          'X-Tried': String(out.tried.length),
          'X-Source': 'live',
        },
      });
    }
    // LIVE 取得が全滅した場合: GitHub Pages 上のスナップショットへフォールバック
    const snap = await trySnapshot(market);
    if (snap.ok) {
      return new Response(snap.buf, {
        status: 200,
        headers: {
          'Content-Type': snap.contentType,
          // スナップショットは古い可能性があるので CDN キャッシュは短め
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Source-Url, X-Via, X-Tried, X-Source, X-Snapshot-Age-Seconds, X-Snapshot-At',
          'X-Source-Url': snap.sourceUrl,
          'X-Via': 'github-snapshot',
          'X-Tried': String(out.tried.length),
          'X-Source': 'github-snapshot',
          'X-Snapshot-Age-Seconds': String(snap.ageSec ?? 0),
          'X-Snapshot-At': snap.snapshotAt || '',
        },
      });
    }
    // 全部ダメ: 構造化 JSON でフロントの診断パネルへ
    return jsonResponse({
      error: 'no working URL',
      market,
      tried: out.tried,
      scrapedLinks: (out.scrapedLinks || []).slice(0, 20),
      snapshot: { tried: snap.attempted || [], reason: snap.reason || null },
    }, 502);
  }

  // ─── ?url=X: 直接 URL 指定 ────────────────────────────────
  if (explicitUrl) {
    if (!ALLOWED.test(explicitUrl)) return jsonResponse({ error: 'only jepx.jp / jepx.org URLs are allowed' }, 400);
    const r = await tryUrl(explicitUrl);
    if (!r.ok) return jsonResponse({ error: 'upstream failed', status: r.status, reason: r.reason }, r.status || 502);
    return new Response(r.buf, {
      status: 200,
      headers: {
        'Content-Type': r.contentType,
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Source-Url',
        'X-Source-Url': explicitUrl,
      },
    });
  }

  return jsonResponse({
    name: 'DENDENLIVE JEPX proxy',
    usage: {
      'market data':  '/api/jepx?market=spot|intraday|forward|baseload|fip',
      'single probe': '/api/jepx?market=spot&probe=1',
      'all probe':    '/api/jepx?diag=1',
      'explicit url': '/api/jepx?url=https://www.jepx.jp/market/excel/spot_2026.csv',
    },
  });
}

// _meta.json を取りに行って updatedAt とエージェント情報を返す。診断用。
async function fetchSnapshotMeta() {
  const url = `${SNAPSHOT_BASE}/_meta.json`;
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'Accept': 'application/json' } });
    if (!r.ok) return { available: false, status: r.status, url };
    const meta = await r.json();
    const ageSec = meta.updatedAt ? Math.floor((Date.now() - new Date(meta.updatedAt).getTime()) / 1000) : null;
    return { available: true, url, ageSec, ...meta };
  } catch (e) {
    return { available: false, url, reason: e?.message || String(e) };
  }
}

// ─── GitHub スナップショットフォールバック ──────────────────
//
// CI (.github/workflows/scrape-jepx.yml) が data/<market>.csv と
// data/_meta.json を 30 分おきに更新する。LIVE が全滅したらここを取りに行く。
async function trySnapshot(market) {
  const csvUrl  = `${SNAPSHOT_BASE}/${market}.csv`;
  const metaUrl = `${SNAPSHOT_BASE}/_meta.json`;
  const attempted = [csvUrl, metaUrl];
  try {
    const [csvR, metaR] = await Promise.all([
      fetch(csvUrl,  { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'Accept': 'text/csv,*/*' } }),
      fetch(metaUrl, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'Accept': 'application/json' } }),
    ]);
    if (!csvR.ok) return { ok: false, attempted, reason: `snapshot HTTP ${csvR.status}` };
    const buf = await csvR.arrayBuffer();
    if (buf.byteLength < 64) return { ok: false, attempted, reason: 'snapshot too small' };

    let snapshotAt = null, ageSec = null;
    if (metaR.ok) {
      try {
        const meta = await metaR.json();
        snapshotAt = meta.updatedAt || null;
        if (snapshotAt) ageSec = Math.floor((Date.now() - new Date(snapshotAt).getTime()) / 1000);
      } catch {}
    }
    return {
      ok: true,
      buf,
      contentType: csvR.headers.get('content-type') || 'text/csv',
      sourceUrl: csvUrl,
      snapshotAt,
      ageSec,
    };
  } catch (e) {
    return { ok: false, attempted, reason: e?.message || String(e) };
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

function absoluteUrl(href, base) {
  try { return new URL(href, base).href; } catch { return href; }
}
