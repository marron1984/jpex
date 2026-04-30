// Vercel Edge Function — 電力ニュース RSS プロキシ。
//
// Google News RSS (`news.google.com/rss/search?q=...`) を関西向けと全国向けの
// 2 系統で取得し、軽量パース → JSON で返す。
//
//   /api/news                  両系統まとめて
//   /api/news?q=kansai         関西エリアのみ
//   /api/news?q=zenkoku        全国のみ
//
// Google News は CORS ブロックなのでサーバ側で取りに行く必要がある。

export const config = { runtime: 'edge' };

const QUERIES = {
  kansai:  '関西電力 OR (関西 電力) OR 大阪 電力 OR (関西 卸電力) OR (関西 JEPX)',
  zenkoku: '電力市場 OR JEPX OR 卸電力 OR 電力需給 OR 電力会社 OR FIT OR FIP',
};

const MAX_ITEMS = 14;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; DENDENLIVE/1.1; +https://github.com/marron1984/jpex)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language': 'ja,en;q=0.7',
};

async function fetchRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
  const r = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { xml: await r.text(), source: url };
}

function stripCdata(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
}

// HTML エンティティの最小デコード (Google News のタイトルに乗る程度)
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function pickTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(stripCdata(m[1]).trim()) : '';
}

function parseRss(xml, max = MAX_ITEMS) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < max) {
    const block = m[1];
    const title   = pickTag(block, 'title');
    const link    = pickTag(block, 'link');
    const pubDate = pickTag(block, 'pubDate');
    const source  = pickTag(block, 'source');
    if (!title) continue;
    items.push({ title, link, pubDate, source, ts: pubDate ? new Date(pubDate).getTime() : 0 });
  }
  return items;
}

export default async function handler(req) {
  const reqUrl = new URL(req.url);
  const q = (reqUrl.searchParams.get('q') || 'all').toLowerCase();

  const targets = (q === 'kansai' || q === 'zenkoku') ? { [q]: QUERIES[q] } : QUERIES;

  const entries = await Promise.all(Object.entries(targets).map(async ([key, query]) => {
    try {
      const { xml, source } = await fetchRss(query);
      return [key, { ok: true, items: parseRss(xml), query, source }];
    } catch (e) {
      return [key, { ok: false, error: e?.message || String(e), query }];
    }
  }));

  return jsonResponse({
    now: new Date().toISOString(),
    streams: Object.fromEntries(entries),
  });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      // RSS は粒度が荒いので 15 分キャッシュ
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
    },
  });
}
