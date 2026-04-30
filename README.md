# DENDENLIVE ⚡

日本卸電力取引所 (JEPX) の **5市場** をリアルタイム表示するダッシュボード。
スポット・時間前・先渡・ベースロード・FIP の主要指標をひと目で。

![10分自動更新](https://img.shields.io/badge/refresh-10min-22d3ee) ![static](https://img.shields.io/badge/build-static-0ea5b7) ![vercel](https://img.shields.io/badge/deploy-Vercel-000) ![license](https://img.shields.io/badge/license-MIT-94a3b8)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarron1984%2Fjpex&project-name=jepx-live&repository-name=jepx-live)

## ウェブで起動 — Vercel (推奨)

このリポジトリは **Vercel** 即デプロイ対応です。ビルドステップなし、設定なし。

### A. ボタンから

上の **Deploy with Vercel** ボタンを押すだけ。Vercel が repo を fork → ビルドなしで配信開始 → 数十秒で `https://<your-project>.vercel.app` が公開されます。

### B. CLI から

```bash
npm i -g vercel
vercel deploy --prod
```

### C. GitHub Integration

[Vercel ダッシュボード](https://vercel.com/new) で `marron1984/jpex` を Import → Deploy。
以後 **`git push` のたびに自動再デプロイ**、PR ごとに Preview URL も発行されます。

### Vercel ならではの利点

`api/jepx.js` (Edge Function) を同梱しています。Vercel 上では:

- ブラウザは **同一オリジンの `/api/jepx?url=...`** を経由して JEPX CSV を取得 → CORS 問題ゼロ
- 5 分間 Edge キャッシュ (`s-maxage=300, stale-while-revalidate=60`) で爆速
- 外部の公開 CORS プロキシ (`corsproxy.io`, `allorigins.win`) に依存しない (フォールバックとしてのみ残置)
- `jepx.jp` / `jepx.org` 以外の URL は弾くオープンプロキシ対策付き

## 別ホスト (GitHub Pages, Netlify, S3 …)

`/api/jepx` は Vercel 専用 (Edge Functions) なので使えませんが、`config.js` のフォールバックチェーン (公開 CORS プロキシ) が自動で次の手段を試すので **静的ファイルだけでも動作** します。

GitHub Pages 用のワークフローも `.github/workflows/pages.yml` に同梱済 (`Settings → Pages → Source: GitHub Actions` を選択するだけ)。

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

## データソースのフォールバック構造

JEPX サーバーが Vercel Edge IP からの fetch を 403 で弾くケースに対応するため、二段構えの実装を持つ:

1. **LIVE** — `/api/jepx?market=<key>` が JEPX を直 fetch。成功すれば即時。
2. **GitHub snapshot** — LIVE 失敗時、Edge Function は `raw.githubusercontent.com/.../data/<market>.csv` を中継 (`X-Source: github-snapshot` ヘッダで識別可能)。`.github/workflows/scrape-jepx.yml` が cron `5,35 * * * *` で 30 分おきに JEPX をスクレイプ → `data/*.csv` を自走 commit。
3. **DEMO** — どちらも失敗 / データ未取得の market は `assets/js/demo.js` の合成データで埋める。

ヘッダの `📦 JEPX X 分前` ピルが LIVE/snapshot 状態を表示する。

## 9 TSO 需給モニタ (denkiyoho)

JEPX が落ちていても画面が「常に LIVE で動く」体験を担保するため、各送配電会社が公開する電力使用実績 CSV を一次 LIVE ソースとして併用する。

- `/api/denkiyoho` — 9 エリア (北海道・東北・東京・中部・北陸・関西・中国・四国・九州) の最新需要を JSON で返す Edge Function。
- `/api/denkiyoho?probe=1` — 各エリアの URL 試行ログだけを返す診断モード (デプロイ後の動作確認に便利)。
- 失敗エリアは合成需要曲線 (二山型ピーク) で補完し、cell ごとに `LIVE` / `DEMO` ピルで識別。

## ローカルで動かす場合

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

> `file://` で直接開くと ESM モジュールがブロックされます。必ず HTTP(S) 経由で。

CORS プロキシを経由するため初回ロードに数秒かかる場合があります。
取得失敗が続く場合は `assets/js/config.js` の `SOURCES.<market>.urls` を実際の最新 URL に更新してください。

## 他のホスティングへ

すべて **静的ファイルのみ** なので、リポジトリ全体を `vercel deploy` / `netlify deploy --prod --dir=.` / S3 同期、いずれでもそのまま動きます。
ビルドステップ・サーバランタイム・環境変数は一切不要です。

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
├── api/
│   └── jepx.js             # Vercel Edge Function: JEPX CSV CORS プロキシ
├── assets/
│   ├── css/styles.css
│   └── js/
│       ├── app.js          # エントリ・状態管理・スケジューラ
│       ├── config.js       # URL 雛形・エリア・配色
│       ├── csv.js          # 軽量 CSV パーサ
│       ├── demo.js         # 取得失敗時のデモデータ生成
│       ├── fetcher.js      # CORS フォールバック・SJIS 復号
│       ├── markets.js      # 各市場 CSV → 構造化データ
│       └── ui.js           # Chart.js 描画 / DOM
├── vercel.json             # Vercel 設定 (キャッシュヘッダ等)
├── .github/workflows/pages.yml  # GitHub Pages 自動デプロイ (任意)
└── README.md
```

## データ出典

- [JEPX 市場情報](https://www.jepx.jp/electricpower/market-data/spot/)

> 当ダッシュボードは JEPX 公式サービスではありません。CSV の取得・利用は JEPX の利用規約に従ってください。
