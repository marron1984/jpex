// JEPX Live — configuration
//
// JEPX 公開 CSV のダウンロード URL 雛形。
// 年は実行時に置換 ({YEAR} はその年の西暦4桁)。
// 命名・パスが変更された場合は配列に候補を増やすだけで自動的にフォールバックする。

export const REFRESH_MS = 10 * 60 * 1000; // 10 分

// CORS 直接 fetch がブロックされた場合に経由するプロキシリスト。
// 順番に試行する。
//   1) `/api/jepx?url=...`  ─ Vercel Edge Function (本リポジトリ同梱、推奨)
//   2) 直 fetch              ─ JEPX が CORS を返した時用 (普通は失敗)
//   3) corsproxy.io          ─ パブリックフォールバック
//   4) allorigins.win        ─ 第二フォールバック
export const CORS_PROXIES = [
  (url) => `/api/jepx?url=${encodeURIComponent(url)}`,
  (url) => url,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

// 各市場の CSV 候補 URL。先頭から試して取れたものを使う。
// {YEAR} は西暦4桁、{FY} は会計年度 (4-3月) に置換される。
export const SOURCES = {
  spot: {
    label: 'スポット市場',
    urls: [
      'https://www.jepx.jp/market/excel/spot_{YEAR}.csv',
      'https://www.jepx.jp/js/csv/spot_summary_{YEAR}.csv',
      'http://www.jepx.org/market/excel/spot_{YEAR}.csv',
    ],
  },
  intraday: {
    label: '時間前市場',
    urls: [
      'https://www.jepx.jp/market/excel/im_{YEAR}.csv',
      'https://www.jepx.jp/market/excel/intraday_{YEAR}.csv',
      'https://www.jepx.jp/js/csv/im_trade_summary_{YEAR}.csv',
    ],
  },
  forward: {
    label: '先渡市場',
    urls: [
      'https://www.jepx.jp/market/excel/forward_{FY}.csv',
      'https://www.jepx.jp/market/excel/forward_{YEAR}.csv',
      'https://www.jepx.jp/js/csv/forward_summary_{FY}.csv',
    ],
  },
  baseload: {
    label: 'ベースロード市場',
    urls: [
      'https://www.jepx.jp/market/excel/baseload_{FY}.csv',
      'https://www.jepx.jp/market/excel/baseload_summary_{FY}.csv',
    ],
  },
  fip: {
    label: 'FIP参照価格',
    urls: [
      'https://www.jepx.jp/market/excel/fip_{FY}.csv',
      'https://www.jepx.jp/market/excel/fip_reference_{FY}.csv',
      'https://www.jepx.jp/js/csv/fip_summary_{FY}.csv',
    ],
  },
};

// エリア定義 (スポット 9 エリア + システム)
export const AREAS = [
  { key: 'system',   label: 'システム', color: '#7df9ff' },
  { key: 'hokkaido', label: '北海道',   color: '#60a5fa' },
  { key: 'tohoku',   label: '東北',     color: '#a78bfa' },
  { key: 'tokyo',    label: '東京',     color: '#f472b6' },
  { key: 'chubu',    label: '中部',     color: '#fb7185' },
  { key: 'hokuriku', label: '北陸',     color: '#fbbf24' },
  { key: 'kansai',   label: '関西',     color: '#facc15' },
  { key: 'chugoku',  label: '中国',     color: '#4ade80' },
  { key: 'shikoku',  label: '四国',     color: '#22d3ee' },
  { key: 'kyushu',   label: '九州',     color: '#34d399' },
];

// 30 分コマ (1..48) → "HH:MM" ラベル
export const SLOT_LABELS = Array.from({ length: 48 }, (_, i) => {
  const minutes = i * 30;
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
});

// 会計年度 (4月開始)
export function fiscalYear(date = new Date()) {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return m >= 4 ? y : y - 1;
}
