# tsundoku-finder

購入済み電子書籍をまとめ、既存AIからMCP経由で次に読む本を探すプロジェクトです。

現在はKindle本棚から少数の書籍情報をJSONへ保存するプロトタイプを実装しています。全件同期・購入済みの判定・書籍情報の補完・DB・MCPはこれから実装します。

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
| `pnpm check` | 型検査・テスト・ビルドを順に実行 |

## Kindle取得プロトタイプ

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
