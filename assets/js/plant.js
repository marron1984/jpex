// 奈良吉野太陽光発電所 (DEMO) — 仮想 2.0MW 太陽光発電所のデモデータ生成。
// 出力プロファイル + 天気予報 (30分刻み 48コマ = 24時間) + 売電収入 を返す。

import { fiscalYear } from './config.js?v=2026.04.30.12';

const PLANT = {
  name: '奈良吉野太陽光発電所',
  type: '太陽光 / Solar PV',
  capacity_kw: 2000,            // 2.0 MW
  operationStart: '2020年',
  cumulativeMWhBase: 32_180,    // 2020 年〜 仮想累計
};

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 太陽光出力係数 0..1。日の出〜日没のあいだだけ発電、正午にピーク。
// 雲量による減衰 + わずかなノイズを乗せる。
function solarFactor(hour, minute = 0, dayOffset = 0, cloudMul = 1.0) {
  const t = hour + minute / 60;
  const SUNRISE = 5.2, SUNSET = 18.8;          // 春先〜初夏想定
  if (t < SUNRISE || t > SUNSET) return 0;
  const peak = (SUNRISE + SUNSET) / 2;          // 12.0
  const halfDay = (SUNSET - SUNRISE) / 2;       // 6.8
  const angle = ((t - peak) / halfDay) * (Math.PI / 2);
  const insolation = Math.cos(angle);           // 1.0 at noon
  if (insolation <= 0) return 0;
  const seasonal = 0.78 + Math.sin((dayOffset / 30) * Math.PI * 2) * 0.10;
  const noise = (Math.sin(dayOffset * 7.13 + t * 1.91) + Math.cos(t * 0.7)) * 0.025;
  return Math.max(0, Math.min(0.96, Math.pow(insolation, 1.4) * seasonal * cloudMul + noise));
}

// ───── 天気予報 (30 分刻み 48 コマ) ─────────────────────────

const WEATHER_CONDITIONS = [
  { key: 'sunny',         icon: '☀️', label: '晴',         color: '#fbbf24', solarMul: 1.00, cloudPct: 5  },
  { key: 'mostly-sunny',  icon: '🌤', label: '晴時々曇',   color: '#facc15', solarMul: 0.85, cloudPct: 30 },
  { key: 'partly-cloudy', icon: '⛅',  label: '曇時々晴',   color: '#cbd5e1', solarMul: 0.65, cloudPct: 55 },
  { key: 'cloudy',        icon: '☁️', label: '曇',         color: '#94a3b8', solarMul: 0.40, cloudPct: 80 },
  { key: 'light-rain',    icon: '🌦', label: '小雨',       color: '#7dd3fc', solarMul: 0.25, cloudPct: 90 },
  { key: 'rain',          icon: '🌧', label: '雨',         color: '#38bdf8', solarMul: 0.15, cloudPct: 95 },
  { key: 'storm',         icon: '⛈',  label: '雷雨',       color: '#a78bfa', solarMul: 0.08, cloudPct: 99 },
];

// 連続性のあるランダムウォークで天気を生成し、表示時にまだら過ぎないようにする
let _weatherSeed = null;
function pickInitialIdx() {
  // 日付シードで毎日同じ初期値 (デモ感を演出)
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return seed % WEATHER_CONDITIONS.length;
}

export function demoWeather() {
  const now = new Date();
  // 30分単位に切り上げ
  const startMs = Math.ceil(now.getTime() / (30 * 60 * 1000)) * 30 * 60 * 1000 - 30 * 60 * 1000;
  let idx = _weatherSeed ?? (_weatherSeed = pickInitialIdx());
  const slots = [];
  for (let i = 0; i < 48; i++) {
    const t = new Date(startMs + i * 30 * 60 * 1000);
    // ランダムウォーク (30%確率で 1 段階移動、極端値ほど戻りやすく)
    if (Math.random() < 0.30) {
      const drift = Math.random() < 0.5 ? -1 : 1;
      const bias = (idx >= 4 && drift > 0) ? -drift : (idx <= 1 && drift < 0) ? -drift : drift;
      idx = Math.max(0, Math.min(WEATHER_CONDITIONS.length - 1, idx + bias));
    }
    const cond = WEATHER_CONDITIONS[idx];

    const h = t.getHours(), mm = t.getMinutes();
    // 気温: 14:00 ピーク、5:00 最低の sin カーブ + 雨で -2℃
    const tempBase = 17 + Math.sin(((h + mm/60 - 5) / 24) * Math.PI * 2) * 8;
    const tempAdj = (cond.key === 'rain' || cond.key === 'storm') ? -2.5 : 0;
    const temp = Math.round((tempBase + tempAdj + (Math.random() - 0.5) * 1.0) * 10) / 10;

    const factor = solarFactor(h, mm, 0, cond.solarMul);
    const expectedKw = Math.round(PLANT.capacity_kw * factor);

    slots.push({
      time: t,
      timeStr: `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`,
      condition: cond,
      temp,
      cloudPct: cond.cloudPct,
      expectedKw,
      isNow: i === 0,
    });
  }
  return slots;
}

// ───── 発電所ダッシュボード ─────────────────────────────────

export function demoPlant() {
  const now = new Date();
  const todayStr = ymd(now);
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // 30 日分の時間別 kW
  const hourly = [];
  for (let d = 29; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dateStr = ymd(date);
    // 当日の天気 (簡易): 日付シードベース
    const dayCond = WEATHER_CONDITIONS[(date.getDate() * 7 + date.getMonth() * 3) % WEATHER_CONDITIONS.length];
    for (let h = 0; h < 24; h++) {
      // 当日は現在時刻まで
      if (dateStr === todayStr && h > currentHour) break;
      const factor = solarFactor(h, 0, d, dayCond.solarMul);
      const kw = Math.round(PLANT.capacity_kw * factor);
      hourly.push({ date: dateStr, hour: h, kw });
    }
  }

  // 日次集計
  const dailyMap = {};
  for (const h of hourly) {
    const d = dailyMap[h.date] ||= { date: h.date, kwh: 0, peakKw: 0, hours: 0 };
    d.kwh += h.kw;
    d.peakKw = Math.max(d.peakKw, h.kw);
    d.hours += 1;
  }
  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  const todayHourly = hourly.filter(h => h.date === todayStr);
  const todayDaily  = dailyMap[todayStr] || { kwh: 0, peakKw: 0 };
  const last7  = daily.slice(-7);
  const last30Kwh = daily.reduce((s, d) => s + d.kwh, 0);
  const last30AvgKw = last30Kwh / (24 * 30);
  const cumulativeMWh = PLANT.cumulativeMWhBase + Math.round(last30Kwh / 1000);

  // 現在出力: solarFactor を直接呼ぶ (30 分単位の hourly では分単位の動きが出ないため)
  const currentFactor = solarFactor(currentHour, currentMinute, 0, 0.9);
  const current = Math.round(PLANT.capacity_kw * currentFactor);

  const yesterday = daily[daily.length - 2];
  const dayOnDayPct = yesterday && yesterday.kwh ? ((todayDaily.kwh - yesterday.kwh) / yesterday.kwh) * 100 : null;

  return {
    name: PLANT.name,
    type: PLANT.type,
    capacityKw: PLANT.capacity_kw,
    operationStart: PLANT.operationStart,
    currentKw: current,
    capacityFactor: (current / PLANT.capacity_kw) * 100,
    todayKwh: todayDaily.kwh,
    todayPeakKw: todayDaily.peakKw,
    last30Kwh,
    last30AvgKw,
    last30CapacityFactor: (last30AvgKw / PLANT.capacity_kw) * 100,
    cumulativeMWh,
    dayOnDayPct,
    todayHourly,
    last7,
    daily,
  };
}

// ───── 売電収入 (DEMO) ────────────────────────────────────────
//
// JEPX 関西エリアスポット価格 × FIP プレミアムで売電単価を構成。
// 24h: 30 分コマ × 48 で kWh × 単価を積算 → 本日売電収入。
// 30日: plant.daily の kwh × 日別平均価格 で簡易集計。

const FIP_PREMIUM = 4.20;          // ¥/kWh — 太陽光 50kW 以上 FIP プレミアム想定
const FALLBACK_KANSAI_BASE = 9.50; // 関西エリア平均仮定

// 30 分スロット (0-47) → 関西エリア相当のスポット価格 (¥/kWh)
// 朝 7-9 / 夕 17-20 にピーク、昼 11-14 にソーラー過剰で dip する典型 W 字
function syntheticKansai(slotIdx, dayOffset = 0) {
  const t = slotIdx * 0.5; // hour
  const morning = Math.exp(-Math.pow((t - 8.0) / 1.5, 2)) * 7.5;
  const evening = Math.exp(-Math.pow((t - 19.0) / 1.7, 2)) * 11.5;
  const noonDip = -Math.exp(-Math.pow((t - 12.0) / 2.2, 2)) * 6.2;
  const seasonal = Math.sin((dayOffset / 30) * Math.PI * 2) * 0.8;
  const noise = Math.sin(slotIdx * 1.31 + dayOffset * 2.7) * 0.45;
  return Math.max(1.5, FALLBACK_KANSAI_BASE + morning + evening + noonDip + seasonal + noise);
}

// 実 spot 配列 (records) から本日コマごとの kansai 価格を引く。
// 取れない slot は syntheticKansai でフォールバック。
function todaySlotPrices(spotRecords) {
  const arr = new Array(48).fill(null);
  if (Array.isArray(spotRecords) && spotRecords.length) {
    const dates = [...new Set(spotRecords.map(r => r.date))].sort();
    const today = dates[dates.length - 1];
    for (const r of spotRecords) {
      if (r.date !== today) continue;
      const idx = (r.slot | 0) - 1;
      if (idx >= 0 && idx < 48 && r.kansai != null) arr[idx] = r.kansai;
    }
  }
  for (let i = 0; i < 48; i++) {
    if (arr[i] == null) arr[i] = syntheticKansai(i, 0);
  }
  return arr;
}

export function demoRevenue(plant, spotRecords) {
  if (!plant) return null;
  const now = new Date();
  const todayStr = ymd(now);
  const currentSlotIdx = Math.min(47, Math.floor((now.getHours() * 60 + now.getMinutes()) / 30));

  const kansai = todaySlotPrices(spotRecords);

  // 本日: 0..currentSlotIdx までの 30 分積算 (kWh = kW × 0.5h)
  const slots = [];
  let todayRev = 0;
  let todayKwh = 0;
  for (let i = 0; i < 48; i++) {
    const h = Math.floor(i / 2);
    const m = (i % 2) * 30;
    const factor = solarFactor(h, m, 0, 0.92);
    const kwhSlot = PLANT.capacity_kw * factor * 0.5;
    const unit = kansai[i] + FIP_PREMIUM;
    const rev = kwhSlot * unit;
    const isPast = i <= currentSlotIdx;
    if (isPast) {
      todayKwh += kwhSlot;
      todayRev += rev;
    }
    slots.push({
      slot: i + 1,
      timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      kansai: kansai[i],
      premium: FIP_PREMIUM,
      unit,
      kwh: kwhSlot,
      revenue: rev,
      isPast,
      isCurrent: i === currentSlotIdx,
    });
  }
  const todayUnit = todayKwh > 0 ? todayRev / todayKwh : null;

  // 30 日履歴: plant.daily の kwh × 日別平均価格
  const dailyRev = plant.daily.map((d, idx) => {
    const dayOffset = plant.daily.length - 1 - idx;
    // 1 日の代表価格 = 各スロット価格の発電量加重平均
    let wsum = 0, wkwh = 0;
    for (let i = 0; i < 48; i++) {
      const h = Math.floor(i / 2);
      const factor = solarFactor(h, (i % 2) * 30, dayOffset, 0.85);
      const slotKwh = PLANT.capacity_kw * factor * 0.5;
      const slotPrice = syntheticKansai(i, dayOffset) + FIP_PREMIUM;
      wsum  += slotKwh * slotPrice;
      wkwh  += slotKwh;
    }
    const avgUnit = wkwh > 0 ? wsum / wkwh : FALLBACK_KANSAI_BASE + FIP_PREMIUM;
    return { date: d.date, kwh: d.kwh, revenue: d.kwh * avgUnit, unit: avgUnit };
  });

  // 月累計 / 年度累計 (30 日しか持っていないので接続的に外挿)
  const monthStr = todayStr.slice(0, 7);
  const monthDays = dailyRev.filter(d => d.date.startsWith(monthStr));
  const monthRev = monthDays.reduce((s, d) => s + d.revenue, 0);
  const monthKwh = monthDays.reduce((s, d) => s + d.kwh, 0);

  const fy = fiscalYear(now);
  const fyStart = new Date(fy, 3, 1); // 4/1
  const fyDays = Math.max(1, Math.floor((now - fyStart) / 86_400_000) + 1);
  const dailyAvgRev = dailyRev.length ? dailyRev.reduce((s, d) => s + d.revenue, 0) / dailyRev.length : 0;
  const dailyAvgKwh = dailyRev.length ? dailyRev.reduce((s, d) => s + d.kwh, 0) / dailyRev.length : 0;
  const fyRev = dailyAvgRev * fyDays;
  const fyKwh = dailyAvgKwh * fyDays;

  // DoD / vs 30日平均 (本日リアルタイム積算と直近確定日比較)
  const yesterday = dailyRev[dailyRev.length - 2];
  const dod = (yesterday && yesterday.revenue) ? ((todayRev - yesterday.revenue) / yesterday.revenue) * 100 : null;
  const vsAvg = (dailyAvgRev) ? ((todayRev - dailyAvgRev) / dailyAvgRev) * 100 : null;

  // 機会損失/うまみ: もし FIP プレミアム抜きでスポットだけだったら
  const todaySpotOnly = slots.filter(s => s.isPast).reduce((s, x) => s + x.kwh * x.kansai, 0);
  const fipBonus = todayRev - todaySpotOnly;

  return {
    fy,
    fyDays,
    fipPremium: FIP_PREMIUM,
    todayRev,
    todayKwh,
    todayUnit,
    todaySpotOnly,
    fipBonus,
    monthRev,
    monthKwh,
    fyRev,
    fyKwh,
    dod,
    vsAvg,
    dailyAvgRev,
    slots,
    dailyRev,
    currentSlotIdx,
    spotIsLive: Array.isArray(spotRecords) && spotRecords.length > 0,
  };
}
