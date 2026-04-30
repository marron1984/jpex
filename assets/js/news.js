// 電力ニュース取得モジュール: /api/news を 30 分キャッシュで叩く。
//
// 戻り値:
// {
//   isLive: boolean,
//   updatedAt: ISO,
//   kansai:  [{ title, link, pubDate, source, ts }, ...],
//   zenkoku: [{ ... }],
//   error?: string,
// }

let _cached = null;
let _cachedAt = 0;
const CACHE_MS = 15 * 60 * 1000;   // 15 分。Edge 側の s-maxage と一致

export async function fetchNews({ signal } = {}) {
  const now = Date.now();
  if (_cached && now - _cachedAt < CACHE_MS) return _cached;
  try {
    const r = await fetch('/api/news', { signal, cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    const out = {
      isLive: true,
      updatedAt: json.now || new Date().toISOString(),
      kansai:  json.streams?.kansai?.items  || [],
      zenkoku: json.streams?.zenkoku?.items || [],
      kansaiOk:  json.streams?.kansai?.ok  ?? false,
      zenkokuOk: json.streams?.zenkoku?.ok ?? false,
    };
    _cached = out;
    _cachedAt = now;
    return out;
  } catch (e) {
    return {
      isLive: false,
      error: e?.message || String(e),
      updatedAt: null,
      kansai: [], zenkoku: [],
    };
  }
}

export function lastCachedNews() { return _cached; }
