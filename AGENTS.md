# 開発環境

- 実装言語はTypeScriptとする。
- パッケージ管理にはpnpmを使用する。npm・yarn・bunで依存関係を操作しない。
- Node.jsの導入・バージョン管理もpnpm経由で行う。
- Node.jsとpnpmのバージョンは、プロジェクトの設定に従う。
- Node.jsはpackage.jsonのdevEngines.runtimeでプロジェクト単位に管理する。直接実行するときはpnpm exec nodeを使う。
- ユーザー全体のPATHやグローバル環境を変更する必要がある場合は、変更内容を事前に説明する。

# 設計と検討記録

- 実装前にdoc/01architecture_discussion.mdの関連箇所を確認する。
- doc/01architecture_discussion.mdは設計書として、決定済みの要件・設計方針を記載する。推奨案や評価結果を採用決定として扱わない。
- 製品・ライブラリ・APIサービスの比較評価や調査結果はdoc/02product_evaluation.mdに記載する。外部情報には調査日と出典、未確認事項を添える。
- 未決の設計案や検証計画はdoc/03design_notes.mdに記載する。決定した内容だけを設計書へ反映し、関連文書の記述も整える。
- 初期対象はKindleとし、所有情報の同期・書籍情報の補完・MCPを分離する。
- ゲーム版は別システム・別DBを想定する。基盤の再利用を妨げない構造にするが、未使用の汎用機構は先行実装しない。

# ローカルデータ

- 認証情報、ブラウザのセッション、実際の蔵書DB、個人情報を含む取得データをGitに登録しない。
- テスト用データには架空データまたは個人情報を除去したデータを使う。
- 同期で取得できなかったことだけを理由に、既存の所有情報を削除しない。

# 検証とコミット

- 変更に応じた型検査・ビルド・テストを実行する。実行できなかった検証は理由とともに報告する。
- 開発コマンドはpnpm dev、型検査はpnpm typecheck、テストはpnpm test、ビルドはpnpm buildとする。まとめて検証する場合はpnpm checkを使う。
- formatter・linterはBiomeに統一する。整形はpnpm format、lintはpnpm lint、安全なlint修正はpnpm lint:fixを使う。pnpm checkには整形・lint・import整理の確認も含む。警告も失敗として扱う。
- コミット前にHuskyとlint-stagedでステージ対象を検査・安全に自動修正する。フックを迂回せず、未解決の指摘は修正する。--unsafeによる一括修正は行わない。
- Biomeは標準の整形設定と推奨lintルールを使う。対象はTypeScript・JavaScript・JSON・JSONCとし、個人データ・生成物を除外する。Markdown・YAMLの整形ツールは追加しない。
- 操作履歴を残す意味でも、一連の操作の区切りの都度gitへコミットする。
- コミット前に差分を確認し、無関係な変更や機密情報を含めない。
- ユーザーが作成した変更を勝手に取り消さない。
