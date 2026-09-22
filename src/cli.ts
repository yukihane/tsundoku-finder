const args = process.argv.slice(2);

if (
	args.length === 0 ||
	(args.length === 1 && ["--help", "-h"].includes(args[0] ?? ""))
) {
	console.log(`tsundoku-finder

使い方: pnpm dev
        pnpm dev kindle login
        pnpm dev bookwalker purchases [--limit 1〜25]
        pnpm dev library import-bookwalker <保存済みJSON>
        pnpm dev kindle sample [--limit 1〜50]
        pnpm dev kindle reading-sample [--limit 1〜25]
        pnpm dev metadata kindle <所有ASIN>
        pnpm dev metadata bookwalker <所有UUID>
        pnpm dev metadata import <保存済みJSON>
        pnpm dev metadata summary
        pnpm dev kindle purchases [--limit 1〜25]
        pnpm dev kindle purchases --all [--max-pages 1〜1000]
        pnpm dev library import-kindle <取得フォルダー>
        pnpm dev library summary
        pnpm dev library search "検索語" [--limit 1〜100] [--offset 0〜100000]
        pnpm dev library get <商品ID> [--store kindle-jp|bookwalker-jp]

購入済み電子書籍から次の一冊を探すツールです。
kindle login: 専用ブラウザでログインし、認証状態をローカルに保持します。
kindle sample: 表示済みの書籍を最大10件（変更可）JSONに保存します。
kindle purchases: 購入済み一覧の先頭ページから最大10件（変更可）を根拠付きで保存します。
--all: ページごとに保存して全件取得します。上限到達・失敗は未完了として終了します。
library import-kindle: 完了済みの取得JSONをローカルSQLiteへ取り込みます。
library summary: DBの書籍数・取り込み数を表示します。
library searchは--publisher "出版社名"でも絞り込めます。
書誌情報の保存・検索に対応しています。読書状態のDB保存は未実装です。MCPの導入は保留しています。`);
} else if (args[0] === "bookwalker" && args[1] === "purchases") {
	try {
		if (
			!(
				args.length === 2 ||
				(args.length === 4 &&
					args[2] === "--limit" &&
					/^\d+$/.test(args[3] ?? ""))
			)
		)
			throw new Error("Invalid arguments");
		const { capturePurchasedSample } = await import(
			"./bookwalker/purchases.js"
		);
		await capturePurchasedSample(args.length === 2 ? 10 : Number(args[3]));
	} catch {
		console.error(
			"BOOK☆WALKER取得に失敗しました。--limit（1〜25）、認証・一覧の先頭ページ・表示形式を確認してください。DBは更新していません。",
		);
		process.exitCode = 1;
	}
} else if (
	args[0] === "library" &&
	args[1] === "import-bookwalker" &&
	args.length === 3 &&
	args[2]
) {
	try {
		const { importBookwalkerSample } = await import("./bookwalker/import.js");
		console.log(JSON.stringify(await importBookwalkerSample(args[2]), null, 2));
	} catch {
		console.error(
			"BOOK☆WALKER取り込みに失敗しました。保存済みJSON・所有根拠・DBを確認してください。変更は確定していません。",
		);
		process.exitCode = 1;
	}
} else if (
	args[0] === "metadata" &&
	((args.length === 3 && args[1] === "import" && args[2]) ||
		(args.length === 2 && args[1] === "summary"))
) {
	try {
		const { importMetadata, metadataSummary } = await import(
			"./metadata/import.js"
		);
		const result =
			args[1] === "summary"
				? metadataSummary()
				: await importMetadata(args[2] ?? "");
		console.log(JSON.stringify(result, null, 2));
	} catch {
		console.error(
			"書誌情報の処理に失敗しました。保存済みJSON・所有情報・DBを確認してください。取り込みの変更は確定していません。",
		);
		process.exitCode = 1;
	}
} else if (args.length === 3 && args[0] === "metadata" && args[1] && args[2]) {
	try {
		const { captureMetadata } = await import("./metadata/capture.js");
		await captureMetadata(args[1], args[2]);
	} catch {
		console.error(
			"書誌情報を取得できませんでした。ストア・所有商品ID・DB・商品ページの表示を確認してください。DBは更新していません。",
		);
		process.exitCode = 1;
	}
} else if (
	args[0] === "library" &&
	(args[1] === "search" || args[1] === "get")
) {
	try {
		const { searchBooks, getBook } = await import("./library/queries.js");
		const value = args[2];
		if (value === undefined) throw new Error("Missing argument");
		if (args[1] === "get") {
			if (
				args.length !== 3 &&
				!(args.length === 5 && args[3] === "--store" && args[4])
			)
				throw new Error("Unexpected argument");
			console.log(JSON.stringify({ book: getBook(value, args[4]) }, null, 2));
		} else {
			let limit = 20;
			let offset = 0;
			let publisher = "";
			const seen = new Set<string>();
			for (let i = 3; i < args.length; i += 2) {
				const key = args[i] ?? "";
				const number = args[i + 1] ?? "";
				if (
					!["--limit", "--offset", "--publisher"].includes(key) ||
					seen.has(key) ||
					(key === "--publisher" ? !number.trim() : !/^\d+$/.test(number))
				)
					throw new Error("Invalid option");
				seen.add(key);
				if (key === "--publisher") publisher = number;
				else if (key === "--limit") limit = Number(number);
				else offset = Number(number);
			}
			console.log(
				JSON.stringify(
					searchBooks(value, limit, offset, undefined, publisher),
					null,
					2,
				),
			);
		}
	} catch {
		console.error(
			"検索・詳細取得に失敗しました。引数と蔵書DBの取り込み・アクセス状態を確認してください。",
		);
		process.exitCode = 1;
	}
} else if (
	args.length === 3 &&
	args[0] === "library" &&
	args[1] === "import-kindle" &&
	args[2]
) {
	try {
		const { importKindleCollection } = await import("./kindle/import.js");
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
	(args[1] === "sample" ||
		args[1] === "purchases" ||
		args[1] === "reading-sample")
) {
	const maximum = args[1] === "sample" ? 50 : 25;
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
			if (args[1] !== "sample") {
				const { capturePurchasedSample } = await import(
					"./kindle/purchases.js"
				);
				await capturePurchasedSample(limit, args[1] === "reading-sample");
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
