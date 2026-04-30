// CORS プロキシを順番に試しながら、Shift-JIS / UTF-8 を自動判定して
// テキストとして返す fetcher。
//
// 戦略:
//   1) `/api/jepx?market=<key>` ─ Vercel Edge が候補 URL を server-side で
//      順次試して 200 を返したものを中継。最速・最確実。
//   2) `/api/jepx?url=<URL>`    ─ クライアントが知っている URL を Edge 経由で
//   3) 直 fetch                  ─ JEPX が CORS 許可した時用 (普通は失敗)
//   4) corsproxy.io / allorigins ─ パブリックフォールバック

import { CORS_PROXIES } from './config.js?v=2026.04.30.18';

async function tryFetch(url, signal) {
  const res = await fetch(url, {
    cache: 'no-cache',
    redirect: 'follow',
    signal,
    headers: { 'Accept': 'text/csv, text/plain, */*' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${body ? ': ' + body.slice(0, 120) : ''}`);
  }
  const sourceUrl = res.headers.get('x-source-url') || null;
  // /api/jepx は LIVE 失敗時に github-snapshot へフォールバックする。
  // X-Source: live | github-snapshot, X-Snapshot-Age-Seconds, X-Snapshot-At を読み取る。
  const source = res.headers.get('x-source') || (res.headers.get('x-via') === 'github-snapshot' ? 'github-snapshot' : 'live');
  const ageSecRaw = res.headers.get('x-snapshot-age-seconds');
  const snapshotAgeSec = ageSecRaw != null ? Number(ageSecRaw) : null;
  const snapshotAt = res.headers.get('x-snapshot-at') || null;
  const buf = await res.arrayBuffer();
  return { text: decodeBytes(buf), sourceUrl, source, snapshotAgeSec, snapshotAt };
}

// JEPX の CSV は Shift_JIS。文字化け検知のため UTF-8 → Shift_JIS の順で試す。
function decodeBytes(buf) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const replacementCount = (utf8.match(/�/g) || []).length;
  if (replacementCount > 3) {
    try {
      return new TextDecoder('shift_jis').decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

// market モード: /api/jepx?market=<key> 一本に絞る。
// 失敗時は probe で得た tried 配列を errors に詰めて呼び出し元に返す (診断パネル用)。
export async function fetchMarketCsv(marketKey, { signal } = {}) {
  const url = `/api/jepx?market=${encodeURIComponent(marketKey)}`;
  try {
    const r = await tryFetch(url, signal);
    if (r.text && r.text.length > 50) {
      return {
        text: r.text,
        sourceUrl: r.sourceUrl || url,
        source: r.source,                   // 'live' | 'github-snapshot'
        snapshotAgeSec: r.snapshotAgeSec,
        snapshotAt: r.snapshotAt,
      };
    }
    return { errors: [`empty response from ${url}`] };
  } catch (e) {
    // Edge が JSON エラーを返した場合は parse して構造化情報を返す
    let detail = e.message;
    let tried = null;
    try {
      const m = e.message.match(/HTTP (\d+): ({.*})$/s);
      if (m) {
        const obj = JSON.parse(m[2]);
        if (obj.tried) tried = obj.tried;
        if (obj.error) detail = `${obj.error} (HTTP ${m[1]})`;
      }
    } catch {}
    return { errors: [`${url}: ${detail}`], tried };
  }
}

// URL モード: 候補 URL リストを各 CORS プロキシで順に試す (フォールバック)
async function fetchWithProxies(url, signal) {
  const errors = [];
  for (const proxy of CORS_PROXIES) {
    const target = proxy(url);
    try {
      const r = await tryFetch(target, signal);
      if (r.text && r.text.length > 50) return { text: r.text, source: target, sourceUrl: r.sourceUrl };
    } catch (e) {
      errors.push(`${target.slice(0, 70)}…: ${e.message}`);
    }
  }
  throw new Error(errors.join(' / '));
}

export async function fetchCsv(urls, { signal } = {}) {
  const errors = [];
  for (const url of urls) {
    try {
      const out = await fetchWithProxies(url, signal);
      return { ...out, sourceUrl: out.sourceUrl || url };
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }
  const err = new Error(`全候補 fetch 失敗`);
  err.detail = errors;
  throw err;
}

