// 奈良吉野太陽光発電所 (DEMO) — 仮想 2.0MW 太陽光発電所のデモデータ生成。
// 出力プロファイル + 天気予報 (30分刻み 48コマ = 24時間) を返す。

import { fiscalYear } from './config.js?v=2026.04.30.8';

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
