# JEPX Live ⚡

日本卸電力取引所 (JEPX) の **5市場** をリアルタイム表示するダッシュボード。
スポット・時間前・先渡・ベースロード・FIP の主要指標をひと目で。

![10分自動更新](https://img.shields.io/badge/refresh-10min-22d3ee) ![static](https://img.shields.io/badge/build-static-0ea5b7) ![license](https://img.shields.io/badge/license-MIT-94a3b8)

## 表示内容

| 市場 | 内容 |
| --- | --- |
| **スポット** | 30分コマ × 9エリア + システムプライス、約定量、当日プロファイル (昼間/夜間平均、最高/最安値) |
| **時間前** | 加重平均価格・高値・安値 (30分コマ) |
| **先渡** | 商品 (週/月/年)、24h 平均価格、昼間価格、約定量 |
| **ベースロード** | 年度別・エリア別 約定価格と約定量 |
| **FIP参照価格** | エリア別の参照価格推移 |

メイン KPI として直近システムプライス・東京エリア・本日平均・時間前加重平均・約定量・前日比をヘッダ直下に大きく表示。

## 動作の仕組み

- **静的サイト**。サーバー不要。`index.html` をそのまま開く / 任意の静的ホスティング (Vercel, Netlify, GitHub Pages, S3) に配置するだけで動作する。
- ブラウザから JEPX の公開 CSV (`https://www.jepx.jp/market/excel/*.csv`) を直接取得。CORS でブロックされた場合は公開プロキシ (`corsproxy.io` → `allorigins.win`) に自動フォールバック。
- CSV は **Shift_JIS** で配信されているため、`TextDecoder('shift_jis')` で復号。
- **10 分間隔** で自動再取得。タブ復帰時にも即時再取得。
- すべての URL は `assets/js/config.js` の `SOURCES` で書き換え可能 (年度・命名規則の揺れに備えて 2-3 候補を試行する設計)。

## 使い方

```bash
# 1. ローカルプレビュー (任意の静的サーバ)
python3 -m http.server 8080
# → http://localhost:8080 を開く

# 2. ホスティング
#    そのまま GitHub Pages / Vercel / Netlify などにデプロイ
```

CORS プロキシを経由するため初回ロードに数秒かかる場合があります。
取得失敗が続く場合は `assets/js/config.js` の `SOURCES.<market>.urls` を実際の最新 URL に更新してください。

## カスタマイズ

| 設定 | 場所 |
| --- | --- |
| 更新間隔 | `assets/js/config.js` `REFRESH_MS` |
| 候補 CSV URL | `assets/js/config.js` `SOURCES` |
| CORS プロキシ | `assets/js/config.js` `CORS_PROXIES` |
| エリア配色 | `assets/js/config.js` `AREAS` |
| カードレイアウト | `index.html` + `assets/css/styles.css` |

## ディレクトリ

```
.
├── index.html
├── assets/
│   ├── css/styles.css
│   └── js/
│       ├── app.js          # エントリ・状態管理・スケジューラ
│       ├── config.js       # URL 雛形・エリア・配色
│       ├── csv.js          # 軽量 CSV パーサ
│       ├── fetcher.js      # CORS フォールバック・SJIS 復号
│       ├── markets.js      # 各市場 CSV → 構造化データ
│       └── ui.js           # Chart.js 描画 / DOM
└── README.md
```

## データ出典

- [JEPX 市場情報](https://www.jepx.jp/electricpower/market-data/spot/)

> 当ダッシュボードは JEPX 公式サービスではありません。CSV の取得・利用は JEPX の利用規約に従ってください。
