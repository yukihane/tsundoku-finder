const args = process.argv.slice(2);

if (
	args.length === 0 ||
	(args.length === 1 && ["--help", "-h"].includes(args[0] ?? ""))
) {
	console.log(`tsundoku-finder

使い方: pnpm dev
        pnpm dev kindle login
        pnpm dev kindle sample [--limit 1〜50]
        pnpm dev kindle purchases [--limit 1〜25]
        pnpm dev kindle purchases --all [--max-pages 1〜1000]
        pnpm dev library import-kindle <取得フォルダー>
        pnpm dev library summary

購入済み電子書籍から次の一冊を探すツールです。
kindle login: 専用ブラウザでログインし、認証状態をローカルに保持します。
kindle sample: 表示済みの書籍を最大10件（変更可）JSONに保存します。
kindle purchases: 購入済み一覧の先頭ページから最大10件（変更可）を根拠付きで保存します。
--all: ページごとに保存して全件取得します。上限到達・失敗は未完了として終了します。
library import-kindle: 完了済みの取得JSONをローカルSQLiteへ取り込みます。
library summary: DBの書籍数・取り込み数を表示します。
情報補完・MCPは未実装です。`);
} else if (
	args.length === 3 &&
	args[0] === "library" &&
	args[1] === "import-kindle" &&
	args[2]
) {
	try {
		const { importKindleCollection } = await import("./library/database.js");
		const result = await importKindleCollection(args[2]);
		console.log(
			result.alreadyImported
				? `取り込み済みのため変更なし。蔵書: ${result.total}件`
				: `${result.imported}件を取り込みました。蔵書: ${result.total}件`,
		);
	} catch {
		console.error(
			"取り込みに失敗しました。完了済みの取得フォルダー・ファイルの整合性・DBの形式やアクセス状態を確認してください。取り込みの変更は確定していません。",
		);
		process.exitCode = 1;
	}
} else if (
	args.length === 2 &&
	args[0] === "library" &&
	args[1] === "summary"
) {
	try {
		const { librarySummary } = await import("./library/database.js");
		console.log(JSON.stringify(librarySummary(), null, 2));
	} catch {
		console.error(
			"蔵書DBを読み取れませんでした。先に取り込みを実行し、DBの形式・アクセス状態を確認してください。",
		);
		process.exitCode = 1;
	}
} else if (
	args[0] === "kindle" &&
	args[1] === "purchases" &&
	args[2] === "--all"
) {
	const valid =
		args.length === 3 ||
		(args.length === 5 &&
			args[3] === "--max-pages" &&
			/^\d+$/.test(args[4] ?? ""));
	const maximum = args.length === 3 ? 1000 : Number(args[4]);
	if (
		!valid ||
		!Number.isSafeInteger(maximum) ||
		maximum < 1 ||
		maximum > 1000
	) {
		console.error("使い方: kindle purchases --all [--max-pages 1〜1000]");
		process.exitCode = 1;
	} else {
		try {
			const { captureAllPurchases } = await import("./kindle/collect.js");
			if (!(await captureAllPurchases(maximum))) process.exitCode = 1;
		} catch {
			console.error(
				"全件取得を終了できませんでした。ブラウザ・保存先・認証状態を確認してください。既存データは削除していません。",
			);
			process.exitCode = 1;
		}
	}
} else if (
	args[0] === "kindle" &&
	(args[1] === "sample" || args[1] === "purchases")
) {
	const maximum = args[1] === "purchases" ? 25 : 50;
	const validArgs =
		args.length === 2 ||
		(args.length === 4 && args[2] === "--limit" && /^\d+$/.test(args[3] ?? ""));
	const limit = args.length === 2 ? 10 : Number(args[3]);
	if (!validArgs || !Number.isInteger(limit) || limit < 1 || limit > maximum) {
		console.error(
			`kindle ${args[1]} の --limit は1〜${maximum}の整数を指定してください。`,
		);
		process.exitCode = 1;
	} else {
		try {
			if (args[1] === "purchases") {
				const { capturePurchasedSample } = await import(
					"./kindle/purchases.js"
				);
				await capturePurchasedSample(limit);
			} else {
				const { captureKindleSample } = await import("./kindle/sample.js");
				await captureKindleSample(limit);
			}
		} catch {
			console.error(
				"取得に失敗しました。ブラウザの導入・ログイン・検索条件・本棚の表示・多重起動を確認してください。既存ファイルは変更していません。",
			);
			process.exitCode = 1;
		}
	}
} else if (args.length === 2 && args[0] === "kindle" && args[1] === "login") {
	try {
		const { openKindleBrowser } = await import("./kindle/browser.js");
		await openKindleBrowser();
	} catch {
		// Browser errors can contain account-specific URLs; do not dump them.
		console.error(
			"Kindleブラウザを開けませんでした。pnpm exec playwright install chromium の実行、ネット接続、専用ブラウザの多重起動を確認してください。",
		);
		process.exitCode = 1;
	}
} else {
	console.error("未対応の引数です。--help で使い方を確認してください。");
	process.exitCode = 1;
}
