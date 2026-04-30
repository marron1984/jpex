// 軽量 CSV パーサ。改行 / クォート / カンマを正しく扱う。
// 戻り値は string[][] (生の行配列)。

export function parseCsv(text) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { cur.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') {
      cur.push(field); field = '';
      if (cur.length > 1 || cur[0] !== '') rows.push(cur);
      cur = []; i++; continue;
    }
    field += ch; i++;
  }
  // last field
  if (field.length || cur.length) {
    cur.push(field);
    if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  }
  return rows;
}

// ヘッダ行付き CSV を { header, rows } に分解する。
// 先頭の空行や注記行を最大 8 行までスキップして
// 「カラム数最多 & ヘッダらしき行」を見つける。
export function parseCsvWithHeader(text) {
  const all = parseCsv(text);
  if (!all.length) return { header: [], rows: [] };

  let headerIdx = 0;
  let bestLen = all[0].length;
  for (let i = 1; i < Math.min(all.length, 8); i++) {
    if (all[i].length > bestLen) { headerIdx = i; bestLen = all[i].length; }
  }
  const header = all[headerIdx].map(s => (s || '').trim());
  const rows = all.slice(headerIdx + 1).filter(r => r.some(c => c && c.trim() !== ''));
  return { header, rows };
}

// 数値変換 (空文字や "-" は NaN ではなく null)
export function num(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '' || s === '-' || s === '—') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
