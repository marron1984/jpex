// CORS プロキシを順番に試しながら、Shift-JIS / UTF-8 を自動判定して
// テキストとして返す fetcher。

import { CORS_PROXIES } from './config.js?v=2026.04.30.3';

async function tryFetch(url, signal) {
  const res = await fetch(url, {
    cache: 'no-cache',
    redirect: 'follow',
    signal,
    headers: { 'Accept': 'text/csv, text/plain, */*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return decodeBytes(buf);
}

// JEPX の CSV は Shift_JIS。文字化け検知のため UTF-8 → Shift_JIS の順で試す。
function decodeBytes(buf) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // U+FFFD (置換文字) が多い場合は Shift_JIS とみなす
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

// 1 つの URL に対し、複数 CORS プロキシを順に試す。
async function fetchWithProxies(url, signal) {
  const errors = [];
  for (const proxy of CORS_PROXIES) {
    const target = proxy(url);
    try {
      const text = await tryFetch(target, signal);
      if (text && text.length > 50) return { text, source: target };
    } catch (e) {
      errors.push(`${target.slice(0, 60)}…: ${e.message}`);
    }
  }
  throw new Error(`全 fetch 失敗: ${errors.join(' / ')}`);
}

// 候補 URL のリストを順に試行。最初に成功したものを返す。
export async function fetchCsv(urls, { signal } = {}) {
  const errors = [];
  for (const url of urls) {
    try {
      const out = await fetchWithProxies(url, signal);
      return { ...out, sourceUrl: url };
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }
  const err = new Error(`全候補 fetch 失敗`);
  err.detail = errors;
  throw err;
}
