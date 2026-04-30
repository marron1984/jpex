#!/usr/bin/env node
// JEPX 5 市場 CSV を CI から取りに行き、data/*.csv に書き出すスクレイパ。
// GitHub Actions の cron から 30 分おきに走る。Vercel Edge と CI は IP 帯が違う
// ので、Vercel から弾かれる JEPX に CI からは届くケースを取りに行く目的。

import { writeFile, mkdir, readFile } from 'node:fs/promises';

const ALLOWED = /^https?:\/\/(www\.)?jepx\.(jp|org)\//i;

const MARKET_PAGES = {
  spot:     'https://www.jepx.jp/electricpower/market-data/spot/',
  intraday: 'https://www.jepx.jp/electricpower/market-data/intraday/',
  forward:  'https://www.jepx.jp/electricpower/market-data/forward/',
  baseload: 'https://www.jepx.jp/electricpower/market-data/baseload/',
  fip:      'https://www.jepx.jp/electricpower/market-data/fit_fip/',
};

const URL_PATTERNS = {
  spot: [
    'https://www.jepx.jp/market/excel/spot_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/spot_{YEAR_PREV}.csv',
    'https://www.jepx.jp/market/excel/spot_summary_{YEAR}.csv',
    'https://www.jepx.jp/js/csv/spot_summary_{YEAR}.csv',
    'https://www.jepx.jp/js/csv/spot_{YEAR}.csv',
    'http://www.jepx.org/market/excel/spot_{YEAR}.csv',
  ],
  intraday: [
    'https://www.jepx.jp/market/excel/im_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/intraday_{YEAR}.csv',
    'https://www.jepx.jp/market/excel/im_trade_summary_{YEAR}.csv',
    'https://www.jepx.jp/js/csv/im_trade_summary_{YEAR}.csv',
    'https://www.jepx.jp/js/csv/im_{YEAR}.csv',
  ],
  forward: [
    'https://www.jepx.jp/market/excel/forward_{FY}.csv',
    'https://www.jepx.jp/market/excel/forward_summary_{FY}.csv',
    'https://www.jepx.jp/market/excel/forward_{YEAR}.csv',
    'https://www.jepx.jp/js/csv/forward_summary_{FY}.csv',
    'https://www.jepx.jp/market/excel/forward_{FY_PREV}.csv',
  ],
  baseload: [
    'https://www.jepx.jp/market/excel/baseload_{FY}.csv',
    'https://www.jepx.jp/market/excel/baseload_summary_{FY}.csv',
    'https://www.jepx.jp/market/excel/baseload_auction_{FY}.csv',
    'https://www.jepx.jp/js/csv/baseload_{FY}.csv',
    'https://www.jepx.jp/market/excel/baseload_{FY_PREV}.csv',
  ],
  fip: [
    'https://www.jepx.jp/market/excel/fip_{FY}.csv',
    'https://www.jepx.jp/market/excel/fip_reference_{FY}.csv',
    'https://www.jepx.jp/market/excel/fip_{YEAR}.csv',
    'https://www.jepx.jp/js/csv/fip_summary_{FY}.csv',
    'https://www.jepx.jp/market/excel/fip_{FY_PREV}.csv',
  ],
};

const CSV_HREF_RE = /(?:href|src|data-href|data-url|data-file|url)\s*=\s*["']([^"']+\.csv[^"']*)["']/gi;
const CSV_BARE_RE = /https?:\/\/(?:www\.)?jepx\.(?:jp|org)\/[^\s"'<>)\]]+\.csv/gi;

// CI runner は普通のブラウザを装う (UA / Accept まで)。広告ブロック以外は素通し
// する CDN が多い。
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/csv,text/plain,application/octet-stream,*/*;q=0.5',
  'Accept-Language': 'ja,en;q=0.8',
  'Cache-Control': 'no-cache',
};

function fy(d) { return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; }
function expand(p, d = new Date()) {
  return p
    .replaceAll('{YEAR}',      String(d.getFullYear()))
    .replaceAll('{YEAR_PREV}', String(d.getFullYear() - 1))
    .replaceAll('{FY}',        String(fy(d)))
    .replaceAll('{FY_PREV}',   String(fy(d) - 1));
}
function abs(href, base) { try { return new URL(href, base).href; } catch { return href; } }

async function tryUrl(url, { timeoutMs = 12_000 } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const ms = Date.now() - t0;
    if (!r.ok) return { ok: false, status: r.status, ms };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.byteLength < 64) return { ok: false, status: 204, reason: 'too small', bytes: buf.byteLength, ms };
    return { ok: true, status: r.status, buf, bytes: buf.byteLength, ms, contentType: r.headers.get('content-type') || 'text/csv' };
  } catch (e) {
    return { ok: false, status: 0, reason: e?.message || String(e), ms: Date.now() - t0 };
  }
}

async function scrapeLinks(market) {
  const page = MARKET_PAGES[market];
  if (!page) return [];
  try {
    const r = await fetch(page, { headers: { ...HEADERS, 'Accept': 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return [];
    const html = await r.text();
    const set = new Set();
    let m;
    CSV_HREF_RE.lastIndex = 0;
    while ((m = CSV_HREF_RE.exec(html))) set.add(abs(m[1], page));
    CSV_BARE_RE.lastIndex = 0;
    while ((m = CSV_BARE_RE.exec(html))) set.add(m[0]);
    return [...set].filter(u => ALLOWED.test(u));
  } catch { return []; }
}

async function probe(market) {
  const tried = [];
  for (const pat of URL_PATTERNS[market]) {
    const u = expand(pat);
    const r = await tryUrl(u);
    tried.push({ via: 'pattern', url: u, ok: r.ok, status: r.status, reason: r.reason || null, bytes: r.bytes || 0, ms: r.ms });
    if (r.ok) return { ok: true, url: u, via: 'pattern', buf: r.buf, contentType: r.contentType, tried };
  }
  const links = await scrapeLinks(market);
  // 年情報で並べ替え (新しい順)
  const yr = new Date().getFullYear();
  const sorted = links.sort((a, b) => {
    const ay = (a.match(/(\d{4})/) || [, 0])[1] | 0;
    const by = (b.match(/(\d{4})/) || [, 0])[1] | 0;
    return Math.abs(yr - ay) - Math.abs(yr - by);
  });
  for (const u of sorted.slice(0, 12)) {
    const r = await tryUrl(u);
    tried.push({ via: 'scrape', url: u, ok: r.ok, status: r.status, reason: r.reason || null, bytes: r.bytes || 0, ms: r.ms });
    if (r.ok) return { ok: true, url: u, via: 'scrape', buf: r.buf, contentType: r.contentType, tried };
  }
  return { ok: false, tried, scrapedLinks: links.slice(0, 20) };
}

async function loadPrevMeta() {
  try { return JSON.parse(await readFile('data/_meta.json', 'utf8')); } catch { return null; }
}

async function main() {
  await mkdir('data', { recursive: true });
  const prev = await loadPrevMeta();
  const meta = {
    updatedAt: new Date().toISOString(),
    runner: 'github-actions',
    markets: {},
  };

  for (const market of Object.keys(URL_PATTERNS)) {
    process.stdout.write(`[${market}] probing… `);
    const r = await probe(market);
    if (r.ok) {
      await writeFile(`data/${market}.csv`, r.buf);
      meta.markets[market] = { ok: true, url: r.url, via: r.via, bytes: r.buf.byteLength, attempts: r.tried.length };
      console.log(`OK ${r.buf.byteLength}B via ${r.via} <${r.url}>`);
    } else {
      // 既存データは温存。失敗を記録するだけ。
      const prevEntry = prev?.markets?.[market];
      meta.markets[market] = {
        ok: false,
        attempts: r.tried.length,
        lastError: r.tried.find(t => !t.ok)?.reason || `status ${r.tried.find(t => !t.ok)?.status}`,
        keptPrevious: !!prevEntry?.ok,
        previousAt: prevEntry?.ok ? prev.updatedAt : null,
      };
      console.log(`FAIL after ${r.tried.length} attempts`);
    }
  }

  await writeFile('data/_meta.json', JSON.stringify(meta, null, 2) + '\n');

  const okCount = Object.values(meta.markets).filter(m => m.ok).length;
  console.log(`\nResult: ${okCount}/${Object.keys(URL_PATTERNS).length} markets refreshed.`);
  // 失敗だけでも _meta.json は更新する。GitHub Action 側で diff があれば commit。
}

main().catch(e => { console.error(e); process.exit(1); });
