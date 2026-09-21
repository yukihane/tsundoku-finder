# tsundoku-finder

購入済み電子書籍をまとめ、既存AIからMCP経由で次に読む本を探すプロジェクトです。

現在はTypeScriptプロジェクトの土台とヘルプ表示のみ実装しています。Kindle同期・書籍情報の補完・DB・MCPはこれから実装します。

## セットアップ

単体で動作するpnpm 12.5.1を用意し、このディレクトリで実行します。

```powershell
pnpm install --frozen-lockfile
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

## 構成

- `src/cli.ts`: CLIの入口
- `test/`: 自動テスト
- `doc/01architecture_discussion.md`: 決定済みの設計
- `doc/02product_evaluation.md`: 製品・サービスの評価
- `doc/03design_notes.md`: 未決事項と検討案

同期・情報補完・MCPは、実装時にそれぞれモジュールを分けます。

## ローカルデータ

検証時の認証状態や個人情報を含む取得データは、Git対象外の`.local/`に置いてください。実際の蔵書DBや認証情報をテストデータとして登録しないでください。`.gitignore`だけに頼らず、コミット前に差分を確認します。
