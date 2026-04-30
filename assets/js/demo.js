// JEPX CSV が取得できない場合に表示する合成 (デモ) データ。
// 実データに近い形・スケールで生成し、UI 側は「DEMO」バッジで明示する。

import { fiscalYear } from './config.js?v=2026.04.30.14';

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 30 分コマの典型的な需要曲線 (円/kWh の概算)。早朝・昼安・夕方ピーク。
function slotPrice(slot, base, vol = 1) {
  // slot: 1..48 (00:00..23:30)
  const h = (slot - 1) / 2;
  const morning = Math.exp(-((h - 8) ** 2) / 5);     // 8:00 ピーク
  const evening = Math.exp(-((h - 19) ** 2) / 4);    // 19:00 ピーク
  const night   = Math.exp(-((h - 3) ** 2) / 8) * 0.4;
  const noise   = (Math.sin(slot * 1.7) + Math.cos(slot * 0.9)) * 0.6 * vol;
  return base + morning * 6 + evening * 8 - night * 3 + noise;
}

const AREA_OFFSETS = {
  hokkaido: -0.4, tohoku: -0.6, tokyo: 0.5, chubu: 0.2, hokuriku: -0.3,
  kansai: 0.1, chugoku: -0.2, shikoku: -0.1, kyushu: -0.5,
};

export function demoSpot(days = 8) {
  const records = [];
  const today = new Date();
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const dateStr = ymd(date);
    const dayBase = 9 + Math.sin(d * 0.7) * 1.5;
    for (let slot = 1; slot <= 48; slot++) {
      const sys = slotPrice(slot, dayBase);
      const rec = {
        date: dateStr, slot,
        system: round2(sys),
        sellVol: Math.round(8000 + Math.random() * 3000) * 1000,
        buyVol:  Math.round(7800 + Math.random() * 3200) * 1000,
        volume:  Math.round(5500 + Math.random() * 1500) * 1000,
      };
      for (const [k, off] of Object.entries(AREA_OFFSETS)) {
        rec[k] = round2(sys + off + (Math.random() - 0.5) * 0.4);
      }
      records.push(rec);
    }
  }
  // 当日は現在時刻まで切り詰め (「直近コマ」感を出す)
  const now = new Date();
  const todayStr = ymd(now);
  const currentSlot = Math.min(48, Math.floor((now.getHours() * 60 + now.getMinutes()) / 30) + 1);
  return records.filter(r => r.date !== todayStr || r.slot <= currentSlot);
}

export function demoIntraday() {
  const spot = demoSpot(2);
  return spot.map(r => ({
    date: r.date, slot: r.slot,
    price: round2(r.system + (Math.random() - 0.5) * 1.2),
    high:  round2(r.system + 1 + Math.random() * 1.5),
    low:   round2(r.system - 1 - Math.random() * 1.5),
    volume: Math.round(800 + Math.random() * 600) * 1000,
    sellVol: Math.round(2000 + Math.random() * 1000) * 1000,
    buyVol:  Math.round(1900 + Math.random() * 1100) * 1000,
  }));
}

export function demoForward() {
  const products = [
    ['年間', '2026年度 24時間型'],
    ['年間', '2026年度 昼間型'],
    ['月間', '2026年5月 24時間型'],
    ['月間', '2026年5月 昼間型'],
    ['月間', '2026年6月 24時間型'],
    ['月間', '2026年6月 昼間型'],
    ['週間', '2026年5月第2週 24h'],
    ['週間', '2026年5月第3週 24h'],
  ];
  return products.map(([product, period]) => ({
    product,
    period,
    price24: round2(10 + Math.random() * 4),
    priceDay: round2(11 + Math.random() * 4),
    volume: Math.round(50 + Math.random() * 800) * 1000,
  }));
}

export function demoBaseload() {
  const fy = fiscalYear();
  const areas = ['北海道エリア', '東地域 (東北・東京)', '中地域 (中部・北陸・関西)', '西地域 (中国・四国・九州)'];
  const out = [];
  for (const area of areas) {
    out.push({ fy: `${fy}年度 第1回`, area, price: round2(9 + Math.random() * 2.5), volume: Math.round(100 + Math.random() * 400) * 1000 });
    out.push({ fy: `${fy}年度 第2回`, area, price: round2(9.5 + Math.random() * 2.5), volume: Math.round(80 + Math.random() * 300) * 1000 });
  }
  return out;
}

export function demoFip() {
  const out = [];
  const today = new Date();
  for (let m = 11; m >= 0; m--) {
    const d = new Date(today);
    d.setMonth(d.getMonth() - m);
    const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const base = 8 + Math.sin(m * 0.5) * 1.3 + Math.cos(m * 0.3) * 0.6;
    const rec = { date };
    for (const [k, off] of Object.entries(AREA_OFFSETS)) {
      rec[k] = round2(base + off + (Math.random() - 0.5) * 0.5);
    }
    out.push(rec);
  }
  return out;
}

function round2(v) { return Math.round(v * 100) / 100; }
