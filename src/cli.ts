const args = process.argv.slice(2);

if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
  console.log(`tsundoku-finder

使い方: pnpm dev
        pnpm dev kindle login
        pnpm dev kindle sample [--limit 1〜50]
        pnpm dev kindle purchases [--limit 1〜25]

購入済み電子書籍から次の一冊を探すツールです。
kindle login: 専用ブラウザでログインし、認証状態をローカルに保持します。
kindle sample: 表示済みの書籍を最大10件（変更可）JSONに保存します。
kindle purchases: 購入済み一覧の先頭ページから最大10件（変更可）を根拠付きで保存します。
全件同期・情報補完・MCPは未実装です。`);
} else if (args[0] === 'kindle' && (args[1] === 'sample' || args[1] === 'purchases')) {
  const maximum = args[1] === 'purchases' ? 25 : 50;
  const validArgs = args.length === 2 || (args.length === 4 && args[2] === '--limit' && /^\d+$/.test(args[3] ?? ''));
  const limit = args.length === 2 ? 10 : Number(args[3]);
  if (!validArgs || !Number.isInteger(limit) || limit < 1 || limit > maximum) {
    console.error(`kindle ${args[1]} の --limit は1〜${maximum}の整数を指定してください。`);
    process.exitCode = 1;
  } else {
    try {
      if (args[1] === 'purchases') {
        const { capturePurchasedSample } = await import('./kindle/purchases.js');
        await capturePurchasedSample(limit);
      } else {
        const { captureKindleSample } = await import('./kindle/sample.js');
        await captureKindleSample(limit);
      }
    } catch {
      console.error('取得に失敗しました。ブラウザの導入・ログイン・検索条件・本棚の表示・多重起動を確認してください。既存ファイルは変更していません。');
      process.exitCode = 1;
    }
  }
} else if (args.length === 2 && args[0] === 'kindle' && args[1] === 'login') {
  try {
    const { openKindleBrowser } = await import('./kindle/browser.js');
    await openKindleBrowser();
  } catch {
    // Browser errors can contain account-specific URLs; do not dump them.
    console.error('Kindleブラウザを開けませんでした。pnpm exec playwright install chromium の実行、ネット接続、専用ブラウザの多重起動を確認してください。');
    process.exitCode = 1;
  }
} else {
  console.error('未対応の引数です。--help で使い方を確認してください。');
  process.exitCode = 1;
}
