// 奈良吉野発電所 (DEMO) — 仮想的な小水力発電所のデモデータ生成。
// 出力プロファイル・日次発電量・累計などを生成し、UI 側でグラフ/数値表示する。

const PLANT = {
  name: '奈良吉野発電所',
  type: '小水力 / Run-of-river',
  capacity_kw: 1500,            // 1.5 MW
  operationStart: '1962年',
  cumulativeMWhBase: 142_350,   // 累計発電量のベース (運転開始からの仮想値)
};

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 出力係数 0..1 を時刻と季節要因から作る (水力なので比較的安定だが小幅変動)
function loadFactor(h, dayOffset) {
  // 日中の方が需給バランスからわずかに高出力
  const diurnal = 0.82 + Math.cos(((h - 8) / 24) * Math.PI * 2) * 0.06;
  // 月単位のゆるい変動 (流量の季節性)
  const seasonal = 0.05 * Math.sin((dayOffset / 30) * Math.PI * 2);
  // 微細ノイズ
  const noise = (Math.sin(dayOffset * 7.13 + h * 1.91) + Math.cos(h * 0.7)) * 0.025;
  return Math.max(0.30, Math.min(0.96, diurnal + seasonal + noise));
}

export function demoPlant() {
  const now = new Date();
  const todayStr = ymd(now);
  const currentHour = now.getHours();

  // 過去 30 日分の時間別 (kW)
  const hourly = [];
  for (let d = 29; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dateStr = ymd(date);
    for (let h = 0; h < 24; h++) {
      // 当日は現在時刻まで
      if (dateStr === todayStr && h > currentHour) break;
      const kw = Math.round(PLANT.capacity_kw * loadFactor(h, d));
      hourly.push({ date: dateStr, hour: h, kw });
    }
  }

  // 日次集計
  const dailyMap = {};
  for (const h of hourly) {
    const d = dailyMap[h.date] ||= { date: h.date, kwh: 0, peakKw: 0, hours: 0 };
    d.kwh += h.kw;            // 1時間 × kW = kWh
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

  const current = todayHourly.length ? todayHourly[todayHourly.length - 1].kw : 0;
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
