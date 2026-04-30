// シンプルな疎通確認用エンドポイント。
// /api/health にアクセスして JSON が返れば Edge Function は生きている。

export const config = { runtime: 'edge' };

export default async function handler() {
  return new Response(JSON.stringify({
    ok: true,
    service: 'DENDENLIVE',
    runtime: 'edge',
    timestamp: new Date().toISOString(),
  }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}
