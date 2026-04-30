// Vercel Edge Function — JEPX CSV CORS プロキシ
//
// /api/jepx?url=<JEPX-CSV-URL> にアクセスすると、サーバ側で JEPX を取得し
// CORS ヘッダ付きでブラウザに返す。これにより外部 CORS プロキシが不要になる。
//
// セキュリティ: jepx.jp / jepx.org ドメイン以外は拒否してオープンプロキシ化を防ぐ。

export const config = { runtime: 'edge' };

const ALLOWED = /^https?:\/\/(www\.)?jepx\.(jp|org)\//i;

export default async function handler(req) {
  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get('url');

  if (!target) {
    return text('Missing ?url=', 400);
  }
  if (!ALLOWED.test(target)) {
    return text('Only jepx.jp / jepx.org URLs are allowed', 400);
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'JEPX-Live/1.0 (+https://github.com/marron1984/jpex)',
        'Accept': 'text/csv, text/plain, */*',
      },
      // 静的 CSV なので redirect を辿る
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return text(`Upstream returned ${upstream.status}`, upstream.status);
    }

    const body = await upstream.arrayBuffer();
    const upstreamCt = upstream.headers.get('content-type') || 'text/csv';

    return new Response(body, {
      status: 200,
      headers: {
        // 元の Content-Type をそのまま (Shift_JIS 等) 透過
        'Content-Type': upstreamCt,
        // 5 分 CDN キャッシュ + 1 分 SWR
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'X-Proxy-Source': 'jepx-live-edge',
      },
    });
  } catch (e) {
    return text(`Fetch error: ${e?.message || e}`, 502);
  }
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
