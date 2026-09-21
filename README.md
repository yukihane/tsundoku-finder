# tsundoku-finder

購入済み電子書籍をまとめ、既存AIからMCP経由で次に読む本を探すプロジェクトです。

現在はAmazonの購入済み一覧とKindle本棚から少数の書籍情報をJSONへ保存するプロトタイプを実装しています。全件同期・書籍情報の補完・DB・MCPはこれから実装します。

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

購入済みの情報を取得する場合:

```powershell
pnpm dev kindle purchases --limit 10
```

「コンテンツと端末の管理」の「本 → 購入済み」を開き、先頭ページから最大25件（省略時10件）を`.local/kindle/purchases/`の新しいJSONに保存します。URL・選択中の分類・検索が空であること・件数と行の整合を確認します。認証後に画面を開き直し、一覧の読み込みを待ちます。ログインが必要なら手動で行ってください。

書名・ASIN・著者表示・取得日の表示文字列、ASINから生成した商品URLを保存します。`ownership: "purchased"`はAmazonの購入済み分類を意味し、有料購入の確認ではありません。判定根拠はレポートの`ownershipEvidence`に出典・分類・取得日時とともに保存します。全件取得は未実装で、`complete: false`です。空一覧・表示形式変更・不整合の場合は取得に失敗し、既存のJSONは変更しません。

本棚DOMの調査用コマンドも残しています:

```powershell
pnpm dev kindle sample --limit 10
```

専用ブラウザが開きます。Amazon.co.jpへのログインと追加認証を手動で行ってください。本棚の表示を最大5分待ち、表示済みの情報を`.local/kindle/samples/`の新しいJSONへ保存して終了します。`--limit`は1〜50、省略時は10です。書名・著者の表示文字列・ASIN・表示バッジを保存し、商品URLはASINから組み立てます。

これは全件取得ではありません。認識できるサンプルは除外しますが、読み放題などを購入済みと区別する処理は未実装です。JSONは`complete: false`、`purchaseVerified: false`、各書籍は`ownership: "unknown"`として保存します。空の本棚や画面構造の変更は現在は取得失敗として扱います。

認証状態は`.local/kindle/browser-profile/`に保存され、次回以降に再利用します。通常のChromeや調査用ブラウザとは別のプロファイルです。ログインだけ行う場合は`pnpm dev kindle login`を使い、完了後にウィンドウを閉じてください。専用ブラウザを複数同時に起動しないでください。

テストにもPlaywrightのChromiumが必要です。ブラウザテストは架空ページへの応答に置き換えて実行し、Amazonへアクセスしません。

## 構成

- `src/cli.ts`: CLIの入口
- `src/kindle/`: 専用ブラウザの起動、本棚DOMの読み取り、抽出情報の整形
- `test/`: 自動テスト
- `doc/01architecture_discussion.md`: 決定済みの設計
- `doc/02product_evaluation.md`: 製品・サービスの評価
- `doc/03design_notes.md`: 未決事項と検討案

同期・情報補完・MCPは、実装時にそれぞれモジュールを分けます。

## ローカルデータ

検証時の認証状態や個人情報を含む取得データは、Git対象外の`.local/`に置いてください。実際の蔵書DBや認証情報をテストデータとして登録しないでください。`.gitignore`だけに頼らず、コミット前に差分を確認します。
