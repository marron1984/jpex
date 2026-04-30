// 各市場の CSV を構造化データに変換するパーサ。
// JEPX のヘッダは年度や市場で揺れがあるため、ヘッダ名を「キーワード一致」で
// マッピングする方式を採用 (例: "東京" を含む列 → tokyo)。

import { num } from './csv.js?v=2026.04.30.12';

const AREA_KEYWORDS = {
  hokkaido: ['北海道'],
  tohoku:   ['東北'],
  tokyo:    ['東京'],
  chubu:    ['中部'],
  hokuriku: ['北陸'],
  kansai:   ['関西', '近畿'],
  chugoku:  ['中国'],
  shikoku:  ['四国'],
  kyushu:   ['九州'],
};

function findIdx(header, ...patterns) {
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (!h) continue;
    for (const p of patterns) {
      if (typeof p === 'string') { if (h.includes(p)) return i; }
      else if (p instanceof RegExp) { if (p.test(h)) return i; }
    }
  }
  return -1;
}

function findArea(header, key) {
  const kws = AREA_KEYWORDS[key] || [];
  for (let i = 0; i < header.length; i++) {
    const h = header[i] || '';
    if (kws.some(k => h.includes(k)) && (h.includes('プライス') || h.includes('価格') || h.includes('Price'))) return i;
  }
  // 第二候補: エリア名のみ
  for (let i = 0; i < header.length; i++) {
    const h = header[i] || '';
    if (kws.some(k => h.includes(k))) return i;
  }
  return -1;
}

// "2026/04/30" や "2026-04-30" を Date に
function parseDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ───── スポット市場 ──────────────────────────────────────────────
// 行: 受渡日, 時刻コード(1..48), 売り入札, 買い入札, 約定総量, システムP, エリアP×9, …
export function parseSpot({ header, rows }) {
  const iDate   = findIdx(header, '受渡日', '受け渡し日', /^date$/i);
  const iSlot   = findIdx(header, '時刻コード', /period/i, /時刻/);
  const iSell   = findIdx(header, '売り入札', /sell/i);
  const iBuy    = findIdx(header, '買い入札', /buy/i);
  const iVol    = findIdx(header, '約定総量', '約定量', /contract.*volume/i);
  const iSys    = findIdx(header, 'システムプライス', 'システム価格', /system.*price/i);
  const areaIdx = {};
  for (const k of Object.keys(AREA_KEYWORDS)) areaIdx[k] = findArea(header, k);

  const records = [];
  for (const r of rows) {
    const d = parseDate(r[iDate]);
    if (!d) continue;
    const slot = num(r[iSlot]);
    if (!slot) continue;
    const rec = {
      date: ymd(d),
      slot,
      sellVol: num(r[iSell]),
      buyVol:  num(r[iBuy]),
      volume:  num(r[iVol]),
      system:  num(r[iSys]),
    };
    for (const k of Object.keys(areaIdx)) {
      rec[k] = areaIdx[k] >= 0 ? num(r[areaIdx[k]]) : null;
    }
    records.push(rec);
  }
  return records.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
}

// ───── 時間前市場 ──────────────────────────────────────────────
export function parseIntraday({ header, rows }) {
  const iDate = findIdx(header, '受渡日', /^date$/i);
  const iSlot = findIdx(header, '時刻コード', /period/i);
  const iVol  = findIdx(header, '約定総量', '約定量', /volume/i);
  const iSell = findIdx(header, '売り入札', /sell/i);
  const iBuy  = findIdx(header, '買い入札', /buy/i);
  // 加重平均価格 / VWAP
  let iPrice  = findIdx(header, '加重平均', 'VWAP', /weighted.*avg/i, /average.*price/i);
  if (iPrice < 0) iPrice = findIdx(header, '価格', /price/i);
  const iHigh = findIdx(header, '高値', /high/i);
  const iLow  = findIdx(header, '安値', /low/i);

  const records = [];
  for (const r of rows) {
    const d = parseDate(r[iDate]);
    if (!d) continue;
    const slot = num(r[iSlot]);
    if (!slot) continue;
    records.push({
      date: ymd(d),
      slot,
      sellVol: num(r[iSell]),
      buyVol: num(r[iBuy]),
      volume: num(r[iVol]),
      price: num(r[iPrice]),
      high:  num(r[iHigh]),
      low:   num(r[iLow]),
    });
  }
  return records.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
}

// ───── 先渡市場 ──────────────────────────────────────────────
// 商品 (週・月・年)、24h / 昼間、約定価格、約定量
export function parseForward({ header, rows }) {
  const iProduct = findIdx(header, '商品', /product/i);
  const iPeriod  = findIdx(header, '受渡', /period/i, /delivery/i);
  const iDate    = findIdx(header, '取引日', '受渡開始', /date/i);
  const i24      = findIdx(header, '24時間', '終日', '24h', /24/i);
  const iDay     = findIdx(header, '昼間', /day/i);
  const iVol     = findIdx(header, '約定量', /volume/i);
  const iPrice   = findIdx(header, '約定価格', '価格', /price/i);

  return rows.map(r => ({
    product: r[iProduct] || '',
    period:  r[iPeriod]  || r[iDate] || '',
    price24: num(r[i24]) ?? num(r[iPrice]),
    priceDay: num(r[iDay]),
    volume:  num(r[iVol]),
  })).filter(x => x.product || x.period || x.price24 != null);
}

// ───── ベースロード市場 ──────────────────────────────────────────────
export function parseBaseload({ header, rows }) {
  const iFY    = findIdx(header, '年度', /fiscal/i, /year/i);
  const iArea  = findIdx(header, 'エリア', '受渡', /area/i, /region/i);
  const iPrice = findIdx(header, '約定価格', '価格', /price/i);
  const iVol   = findIdx(header, '約定量', /volume/i);

  return rows.map(r => ({
    fy:    r[iFY] || '',
    area:  r[iArea] || '',
    price: num(r[iPrice]),
    volume: num(r[iVol]),
  })).filter(x => x.price != null || x.volume != null);
}

// ───── FIP 参照価格 ──────────────────────────────────────────────
export function parseFip({ header, rows }) {
  const iDate = findIdx(header, '受渡日', '日付', /date/i);
  const iSlot = findIdx(header, '時刻コード', /period/i);
  const iMonth = findIdx(header, '月', '対象月', /month/i);
  const areaIdx = {};
  for (const k of Object.keys(AREA_KEYWORDS)) areaIdx[k] = findArea(header, k);

  const records = [];
  for (const r of rows) {
    const d = parseDate(r[iDate]);
    const rec = {
      date: d ? ymd(d) : (r[iMonth] || ''),
      slot: num(r[iSlot]) || null,
    };
    for (const k of Object.keys(areaIdx)) {
      rec[k] = areaIdx[k] >= 0 ? num(r[areaIdx[k]]) : null;
    }
    if (Object.values(rec).some(v => typeof v === 'number')) records.push(rec);
  }
  return records;
}
