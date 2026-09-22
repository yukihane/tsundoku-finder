const args = process.argv.slice(2);

if (
	args.length === 0 ||
	(args.length === 1 && ["--help", "-h"].includes(args[0] ?? ""))
) {
	console.log(`tsundoku-finder

使い方: pnpm dev
        pnpm dev kindle login
        pnpm dev bookwalker purchases [--limit 1〜25]
        pnpm dev dmm purchases [--limit 1〜25]
        pnpm dev <bookwalker|dmm> purchases --all [--resume <JSON>] [--max-pages 1〜1000]
        pnpm dev library import-collection <JSON>
        pnpm dev metadata batch [--store kindle|bookwalker|dmm] [--product <ID>] [--limit 1〜25000|--all] [--retry|--refresh]
        pnpm dev metadata batch --resume <実行ID> [--limit 1〜25000|--all]
        pnpm dev metadata status
        pnpm dev library import-dmm <保存済みJSON>
        pnpm dev library import-bookwalker <保存済みJSON>
        pnpm dev kindle sample [--limit 1〜50]
        pnpm dev kindle reading-sample [--limit 1〜25]
        pnpm dev metadata kindle <所有ASIN>
        pnpm dev metadata bookwalker <所有UUID>
        pnpm dev metadata dmm <所有コンテンツID>
        pnpm dev metadata import <保存済みJSON>
        pnpm dev metadata summary
        pnpm dev kindle purchases [--limit 1〜25]
        pnpm dev kindle purchases --all [--max-pages 1〜1000]
        pnpm dev library import-kindle <取得フォルダー>
        pnpm dev library summary
        pnpm dev library search "検索語" [--limit 1〜100] [--offset 0〜100000]
        pnpm dev library get <商品ID> [--store kindle-jp|bookwalker-jp|dmm-books]

購入済み電子書籍から次の一冊を探すツールです。
kindle login: 専用ブラウザでログインし、認証状態をローカルに保持します。
kindle sample: 表示済みの書籍を最大10件（変更可）JSONに保存します。
kindle purchases: 購入済み一覧の先頭ページから最大10件（変更可）を根拠付きで保存します。
--all: ページごとに保存して全件取得します。上限到達・失敗は未完了として終了します。
library import-kindle: 完了済みの取得JSONをローカルSQLiteへ取り込みます。
library summary: DBの書籍数・取り込み数を表示します。
library searchは--publisher "出版社名"でも絞り込めます。
書誌情報の保存・検索に対応しています。読書状態のDB保存は未実装です。MCPの導入は保留しています。`);
} else if (
	(args[0] === "bookwalker" || args[0] === "dmm") &&
	args[1] === "purchases" &&
	args[2] === "--all"
) {
	try {
		let resume: string | undefined;
		let maxPages = 1000;
		const seen = new Set<string>();
		for (let i = 3; i < args.length; i += 2) {
			const key = args[i] ?? "";
			const value = args[i + 1];
			if (seen.has(key) || !value || !["--resume", "--max-pages"].includes(key))
				throw new Error("Invalid option");
			seen.add(key);
			if (key === "--resume") resume = value;
			else {
				if (!/^\d+$/.test(value)) throw new Error("Invalid maximum");
				maxPages = Number(value);
			}
		}
		const { captureCollection } = await import("./ownership-collection.js");
		console.log(await captureCollection(args[0], resume, maxPages));
	} catch {
		console.error(
			"全所有取得を停止しました。保存済みJSONは保持しています。認証・表示条件・件数変化・引数を確認してください。",
		);
		process.exitCode = 1;
	}
} else if (
	args[0] === "library" &&
	args[1] === "import-collection" &&
	args.length === 3 &&
	args[2]
) {
	try {
		const { importCollection } = await import("./ownership-collection.js");
		console.log(JSON.stringify(await importCollection(args[2]), null, 2));
	} catch {
		console.error(
			"全件取り込みに失敗しました。完了状態・件数・所有根拠・DBを確認してください。",
		);
		process.exitCode = 1;
	}
} else if (
	args[0] === "metadata" &&
	args[1] === "status" &&
	args.length === 2
) {
	try {
		const { batchStatus } = await import("./metadata/batch.js");
		console.log(JSON.stringify(batchStatus(), null, 2));
	} catch {
		console.error("処理状況を読み取れませんでした。");
		process.exitCode = 1;
	}
} else if (args[0] === "metadata" && args[1] === "batch") {
	try {
		const { runBatch, batchStatus } = await import("./metadata/batch.js");
		const options: import("./metadata/batch.js").BatchOptions = {};
		const seen = new Set<string>();
		for (let i = 2; i < args.length; i++) {
			const key = args[i] ?? "";
			if (seen.has(key)) throw new Error("Duplicate option");
			seen.add(key);
			if (key === "--all") options.limit = 25000;
			else if (key === "--refresh") options.refresh = true;
			else if (key === "--retry") options.retry = true;
			else {
				const value = args[++i];
				if (!value) throw new Error("Missing value");
				if (key === "--store") options.store = value;
				else if (key === "--product") options.product = value;
				else if (key === "--resume") options.resume = value;
				else if (key === "--limit" && /^\d+$/.test(value))
					options.limit = Number(value);
				else if (key === "--interval-ms" && /^\d+$/.test(value))
					options.intervalMs = Number(value);
				else throw new Error("Invalid option");
			}
		}
		if (seen.has("--all") && seen.has("--limit"))
			throw new Error("Conflicting limit");
		await runBatch(options);
		console.log(JSON.stringify(batchStatus(), null, 2));
	} catch {
		console.error(
			"書誌処理を停止しました。metadata statusで状況を確認し、実行IDを指定して再開してください。引数・DB・保存先も確認してください。",
		);
		process.exitCode = 1;
	}
} else if (args[0] === "dmm" && args[1] === "purchases") {
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
		const { capturePurchasedSample } = await import("./dmm/purchases.js");
		await capturePurchasedSample(args.length === 2 ? 25 : Number(args[3]));
	} catch {
		console.error(
			"DMM取得に失敗しました。--limit（1〜25）、認証・本棚の先頭ページ・購入済み巻一覧・表示条件を確認してください。DBは更新していません。",
		);
		process.exitCode = 1;
	}
} else if (
	args[0] === "library" &&
	args[1] === "import-dmm" &&
	args.length === 3 &&
	args[2]
) {
	try {
		const { importDmmSample } = await import("./dmm/import.js");
		console.log(JSON.stringify(await importDmmSample(args[2]), null, 2));
	} catch {
		console.error(
			"DMM取り込みに失敗しました。保存済みJSON・所有根拠・DBを確認してください。変更は確定していません。",
		);
		process.exitCode = 1;
	}
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
