const args = process.argv.slice(2);

if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
  console.log(`tsundoku-finder

使い方: pnpm dev

購入済み電子書籍から次の一冊を探すツールです。
現在はプロジェクトの初期構成のみです。同期・情報補完・MCPは未実装です。`);
} else {
  console.error('未対応の引数です。--help で使い方を確認してください。');
  process.exitCode = 1;
}
