# tsundoku-finder

購入済み電子書籍をまとめ、既存AIと次に読む本を探すプロジェクトです。

現在はKindleとBOOK☆WALKERの購入済み情報をSQLiteへ取り込み、CLIで横断検索できます。BOOK☆WALKERの取得は先頭25冊までに対応しています。指定した所有ASINの書誌情報を少数取得し、保存済みJSONをDBへ取り込むと、紹介文・分類・出版社なども検索できます。MCPは保留し、当面はローカルコマンドを実行できるAIからSQLite＋CLIを利用します。

## セットアップ

単体で動作するpnpm 12.5.1を用意し、このディレクトリで実行します。

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm exec node --version
pnpm dev
```

Node.jsは事前インストール不要です。`package.json`の`devEngines.runtime`に指定したNode.js 24.21.0をpnpmが取得し、プロジェクトのコマンド実行に利用します。初回セットアップにはネット接続が必要です。

ユーザー全体のPATHは変更しません。Node.jsを直接使う場合は`pnpm exec node`を使用してください。依存管理もpnpmに統一します。

## 開発コマンド

| コマンド | 用途 |
|---|---|
| `pnpm dev` | TypeScriptのCLIを実行 |
| `pnpm typecheck` | ソースとテストの型検査 |
| `pnpm test` | Node.js標準テストランナーでテスト |
| `pnpm build` | `dist/`にJavaScriptを生成 |
| `pnpm start` | ビルド済みCLIを実行（事前にbuildが必要） |
| `pnpm format` | Biomeで整形 |
| `pnpm lint` | Biomeでlint（警告も失敗扱い） |
| `pnpm lint:fix` | Biomeで安全なlint修正 |
| `pnpm check` | Biomeの整形・lint・import整理の確認、型検査・テスト・ビルド |

BiomeはTypeScript・JavaScript・JSON・JSONCを対象とし、標準の整形設定・推奨lintルール・import整理を使います。Markdown・YAML、生成物、`.local/`などの個人データは対象外です。まとめて安全に修正する場合は`pnpm exec biome check --write .`を使います。

`pnpm install`のprepare処理で、このリポジトリにHuskyのGitフックを設定します。コミット前に`pnpm exec lint-staged`がコミット対象へBiomeの安全な自動修正を実行し、結果をステージします。警告・エラーが残るとコミットを停止します。部分ステージ時の未ステージ変更はlint-stagedが一時退避・復元します。復元で競合した場合は表示される案内に従い、差分を確認してください。

フックにも単体で動作するpnpmが必要です。GUIからコミットする場合は、そのアプリのPATHにもpnpmが必要です。グローバルのNode.jsは不要です。フックの再設定は`pnpm run prepare`で行います。型検査・テスト・ビルドはフックには含めず、作業の区切りに`pnpm check`を実行します。

## Kindle取得プロトタイプ

購入済み一覧を最後まで取得する場合:

```powershell
pnpm dev kindle purchases --all
```

1ページ25件として先頭から順に取得し、ページの保存後に3秒待って次へ進みます。保存先は`.local/kindle/collections/<実行ID>/`です。各`page-0001.json`等に書籍と判定根拠を保存し、`report.json`に取得件数・ページ一覧・完了状態を記録します。JSONの内容や書名を通常ログには表示しません。

総件数が変わらず、表示範囲が連続し、重複のないASIN件数が総件数に一致した場合だけ`complete: true`、`status: "completed"`、終了コード0になります。これは巡回中の表示の整合確認であり、ストアが固定した時点のスナップショットを保証するものではありません。DBへの同期や削除は行いません。

試運転は`pnpm dev kindle purchases --all --max-pages 2`でページ数を制限できます。上限は1〜1000、既定1000ページです。上限に到達しても残りがある場合は`page-limit`として未完了・終了コード1になります。重複・件数変化・画面変更・認証切れ・通信や保存の失敗でも停止します。自動再試行はしません。

Ctrl+Cや専用ブラウザの終了で中断できます。検証・保存できたページは保持し、`report.json`は一時ファイル経由で更新します。強制終了やディスク障害では`running`のまま残る場合があり、成功として扱わないでください。途中再開は未実装で、再実行は先頭から別フォルダーに保存します。空一覧は現段階では未検証のため取得失敗として扱います。

購入済みの情報を取得する場合:

```powershell
pnpm dev kindle purchases --limit 10
```

「コンテンツと端末の管理」の「本 → 購入済み」を開き、先頭ページから最大25件（省略時10件）を`.local/kindle/purchases/`の新しいJSONに保存します。URL・選択中の分類・検索が空であること・件数と行の整合を確認します。認証後に画面を開き直し、一覧の読み込みを待ちます。ログインが必要なら手動で行ってください。

書名・ASIN・著者表示・取得日の表示文字列、ASINから生成した商品URLを保存します。`ownership: "purchased"`はAmazonの購入済み分類を意味し、有料購入の確認ではありません。判定根拠はレポートの`ownershipEvidence`に出典・分類・取得日時とともに保存します。この少数取得は`complete: false`です。全件取得には`--all`を使います。空一覧・表示形式変更・不整合の場合は取得に失敗し、既存のJSONは変更しません。

本棚DOMの調査用コマンドも残しています:

```powershell
pnpm dev kindle sample --limit 10
```

専用ブラウザが開きます。Amazon.co.jpへのログインと追加認証を手動で行ってください。本棚の表示を最大5分待ち、表示済みの情報を`.local/kindle/samples/`の新しいJSONへ保存して終了します。`--limit`は1〜50、省略時は10です。書名・著者の表示文字列・ASIN・表示バッジを保存し、商品URLはASINから組み立てます。

これは全件取得ではありません。認識できるサンプルは除外しますが、読み放題などを購入済みと区別する処理は未実装です。JSONは`complete: false`、`purchaseVerified: false`、各書籍は`ownership: "unknown"`として保存します。空の本棚や画面構造の変更は現在は取得失敗として扱います。

認証状態は`.local/kindle/browser-profile/`に保存され、次回以降に再利用します。通常のChromeや調査用ブラウザとは別のプロファイルです。ログインだけ行う場合は`pnpm dev kindle login`を使い、完了後にウィンドウを閉じてください。専用ブラウザを複数同時に起動しないでください。

テストにもPlaywrightのChromiumが必要です。ブラウザテストは架空ページへの応答に置き換えて実行し、Amazonへアクセスしません。

## 蔵書DBへの取り込み

### 既読表示の少数検証

```powershell
pnpm dev kindle reading-sample --limit 10
```

購入済み一覧の先頭ページから最大25件（既定10件）の既読表示を観測し、`.local/kindle/reading-samples/`へJSONを保存します。専用ブラウザのログイン状態を再利用します。

商品ID・出典・取得日時とともに、明示的な「読んだ本」表示があれば`kindleReadState: "read"`、それ以外は`"unknown"`を保存します。表示がないことを未読・未着手の証拠にはしません。読書状態の変更、本文の表示、全件取得、DB更新は行いません。このJSONは`library import-kindle`の対象ではありません。

### 購入済み一覧の取り込み

```powershell
pnpm dev library import-kindle .local/kindle/collections/<実行ID>
pnpm dev library summary
```

`<実行ID>`を全件取得時に表示されたフォルダー名へ置き換えてください。DBはプロジェクトの`.local/library.sqlite`に作成します。取得とは別の処理で、ネットワークやブラウザを使わず、全ファイルを検証してからトランザクションで取り込みます。完了済みの`--all`の出力のみ受け付け、途中取得・少数サンプル・欠損・不整合なJSONは拒否します。

書籍はストア（`kindle-jp`）とASINで識別します。同じ取得ファイル一式の再取り込みは変更なしとなり、新しい取得結果は既存の本を更新します。古い取得日時の情報で新しい書名等を上書きせず、今回の一覧にない本も削除しません。取り込み履歴と本ごとの出典・取得日時・購入済みフィルターを保持します。別のAmazonアカウントのデータを同じDBへ取り込む運用は対象外です。

`library summary`は書籍数・取り込み履歴数・取得根拠の件数を表示します。DB操作にはNode.js標準の`node:sqlite`を使用します（固定しているNode 24.21.0ではRelease Candidate扱い）。DBファイルの直接編集はせず、バックアップが必要な場合は本ツールを終了してからコピーしてください。

## 書誌情報の少数取得

```powershell
pnpm dev metadata kindle <所有ASIN>
```

蔵書DBにあるASINを指定すると、ログイン状態を引き継がない一時Chromiumで公開商品ページを開き、1冊分の情報を`.local/metadata/kindle/`へ保存します。ページURL・登録情報のASIN・Kindle版表示を確認し、不一致や確認不能なら保存せず失敗します。ブラウザは処理後に閉じます。自動再試行や一括取得は行いません。

書名・著者表示（形式表示を含む）・出版社・発売日表示・紹介文・ストア分類・シリーズの表示とURLを、出典・取得日時とともに保存します。文字列は表示上の空白等を整理し、紹介文を要約・補作しません。シリーズ情報がないことはシリーズに属さないという判定ではありません。分類を独自ジャンルやR18区分に自動変換しません。

欠損はnullまたは空配列で表し、出版社・紹介文・分類・シリーズの欠損は`missingFields`にも記録します。生HTML・広告・レビューは保存しません。書誌JSONはGit対象外です。CAPTCHA・ログイン・年齢確認などが出て通常の商品欄を読めない場合は失敗します。

### 保存済み書誌情報の取り込み

```powershell
pnpm dev metadata import .local/metadata/kindle/<保存済みファイル>.json
pnpm dev metadata summary
```

ブラウザやネットワークを使わず、所有情報を保持したまま補完情報を別テーブルへ保存します。同一内容の再取り込みは変更なしです。過去の履歴を残し、検索には取得日時が最新の文書を使います。最新文書の欠損は古い値で埋めません。同じ商品・取得日時で内容が異なるJSONは拒否します。初回の書き込み時に既存DBのスキーマを移行します。

`metadata summary`の`captured`は取り込み済み冊数、`pending`は未取り込み冊数、`snapshots`は履歴数です。取り込み済みでも欠損はあり得ます。検証中は購入済み一覧1ページ分（25冊）を基本の固定サンプルとし、保存済みJSONを再利用します。項目追加のたびに全書籍を再取得しません。

## 蔵書の検索・詳細取得

```powershell
pnpm dev library search "検索語"
pnpm dev library search "書名 著者" --limit 10 --offset 0
pnpm dev library search "" --publisher "出版社名"
pnpm dev library get B000000001

# BOOK☆WALKERの詳細取得
pnpm dev library get 00000000-0000-4000-8000-000000000001 --store bookwalker-jp
```

ASINは実際の検索結果の`productId`に置き換えてください。書名・著者に加え、取り込み済みの最新書誌情報の書名・著者・出版社・紹介文・分類・シリーズ表示を部分一致検索します。空白区切りの語はすべて満たす必要があります。ASCII英字の大小は区別しません。全半角・表記揺れの吸収や意味検索は行いません。空文字列を指定すると一覧になります。`--publisher`は出版社の部分一致で絞り込み、出版社未取得の本は該当しません。

検索結果はJSONで、`books`・`total`・`limit`・`offset`・`nextOffset`を返します。既定20件、最大100件で、続きは`nextOffset`を`--offset`へ指定します。`nextOffset: null`なら末尾です。書籍はストア・商品ID順です。`get`は書籍・最新の所有確認根拠・出典付きの最新書誌情報（`metadata`、未取得はnull）を返し、未登録なら`book: null`を返します。どちらもDBを読み取り専用で開きます。

AIから呼ぶ場合も同じコマンドを利用できます。ビルド後、実行ログを混ぜずJSONを取得するには、プロジェクトのディレクトリで`pnpm exec node dist/cli.js library search "検索語"`とします。実際の検索結果には個人の蔵書情報が含まれます。MCPサーバーやAIクライアントへの自動登録は行いません。

## 構成

- `src/cli.ts`: CLIの入口
- `src/kindle/`: 専用ブラウザの起動、本棚DOMの読み取り、抽出情報の整形
- `src/bookwalker/`・`src/dmm/`: ストア別の所有・書誌取得と保存JSON検証
- `src/library/`: SQLiteへの取り込み、読み取り専用の検索・詳細取得
- `src/metadata/`: 書誌情報の少数取得、保存済みJSONの検証・DB取り込み
- `test/`: 自動テスト
- `doc/01architecture_discussion.md`: 決定済みの設計
- `doc/02product_evaluation.md`: 製品・サービスの評価
- `doc/03design_notes.md`: 未決事項と検討案
- `doc/04work_items.md`: 今後の作業リスト・保留事項

同期・情報補完・蔵書検索はそれぞれモジュールを分けます。MCPは必要になった段階で検索モジュールに接続する構成を検討します。

## ローカルデータ

検証時の認証状態や個人情報を含む取得データは、Git対象外の`.local/`に置いてください。実際の蔵書DBや認証情報をテストデータとして登録しないでください。`.gitignore`だけに頼らず、コミット前に差分を確認します。

## BOOK☆WALKERの少数取得

```powershell
pnpm dev bookwalker purchases --limit 25
pnpm dev library import-bookwalker .local/bookwalker/purchases/<保存ファイル名>.json
```

取得時に専用Chromiumが開きます。必要ならその画面でログイン・追加認証してください。認証状態はGit対象外の`.local/bookwalker/browser-profile/`へ保存され、調査時にログインした通常のChromeとは共有しません。取得後はブラウザが閉じます。

先頭ページの個別巻表示から最大25冊を取得し、JSONを保存します。検索・絞り込み条件も記録する部分取得で、全蔵書を網羅した扱いにはしません。取得だけではDBを変更せず、後続のimport-bookwalkerで保存します。以前の調査用JSONは取り込めません。

模擬ページに加え、実サイトの先頭25冊の取得と隔離DBへの取り込みを検証済みです。読書状態のDB保存・全件巡回には未対応です。

## BOOK☆WALKERの書誌情報

所有情報を取り込み済みの商品UUIDを指定します。

```powershell
pnpm dev metadata bookwalker <所有UUID>
pnpm dev metadata import .local/metadata/bookwalker/<保存ファイル名>.json
pnpm dev library search "検索語" --publisher "出版社"
```

出版社・紹介文・カテゴリ・シリーズに加え、レーベル・ジャンルも語句検索できます。配信開始日は発売日と別に保存します。取得は一度に1冊で、所有DBの情報は上書きしません。書誌取り込みは最新文書を検索対象にし、過去の文書も残します。

書誌取得はログイン状態を引き継がない一時ブラウザを使います。模擬ページに加え、未ログインでの実サイト取得・隔離DBへの取り込み・検索を、追加の漫画5作品（出版社5社）でも検証済みです。最新刊表示や短い紹介文に対応しています。技術書・小説・シリーズなし・年齢確認が必要な商品は未確認です。

## DMMブックスの少数取得・書誌補完

```powershell
pnpm dev dmm purchases --limit 25
pnpm dev library import-dmm .local/dmm/purchases/<保存ファイル名>.json
pnpm dev metadata dmm <所有コンテンツID>
pnpm dev metadata import .local/metadata/dmm/<保存ファイル名>.json
pnpm dev library get <所有コンテンツID> --store dmm-books
```

対象は`https://book.dmm.com/shelf/`です。専用Chromiumで必要なログイン・追加認証を行ってください。認証状態は`.local/dmm/browser-profile/`に保存し、通常のChromeとは共有しません。

本棚はシリーズ単位なので、先頭ページ（最大20シリーズ）から各シリーズの「購入済み」巻一覧の先頭ページを順に確認します。取り込み対象が指定冊数に達したら止めます。`--limit`は1〜25冊、既定25冊です。件数検証用に最後の巻一覧ページ全体をJSONに保持するため、保存JSONの行数は上限を超える場合がありますが、DBに取り込むのは指定冊数までです。本棚・巻一覧とも次ページへ進まず、常に部分取得として保存します。

検証済みの表示条件は、検索なし・購入日が新しい順・「全年齢 / R18すべて」・「購入済みすべて」・期限切れ作品非表示です。条件が異なる場合は失敗し、自動で変更しません。無料・有料の区別や全利用権の網羅は保証しません。成人向け・話単位など未確認の画面への対応は今後の検証対象です。

コンテンツIDと巻ごとの「購入済み」表示を照合し、`latest`リンクは固定IDへ解決します。ダウンロードリンクはID確認のために読むだけで、本文を取得しません。本棚の著者表示を保存し、所有一覧にない購入日はnullにします。取得JSONは`.local/dmm/purchases/`へ保存し、取得コマンド自体はDBを更新しません。

書誌取得は所有DBの商品URLを使い、未ログインの一時Chromiumで1冊ずつ行います。出版社・紹介文・分類・シリーズ・レーベル・ジャンル・配信開始日を保存し、共通検索に利用できます。販売終了商品などで商品欄を確認できない場合は失敗し、所有情報・既存書誌を維持します。

実サイトでは所有25冊と書誌2冊を取り込み、再取り込み・検索・既存ストアデータの保持・SQLite整合性を確認済みです。DBは書き込み時にスキーマv4へ更新します。更新前のバックアップは、ツールを終了してDBをコピーしてください。
