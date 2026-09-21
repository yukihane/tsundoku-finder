import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importOwnership, readLibrary } from "../src/library/database.js";
import type { OwnershipImport, Store } from "../src/library/ownership.js";
import { getBook, searchBooks } from "../src/library/queries.js";
import { legacySchema } from "./legacy-database.js";

const uuid = "00000000-0000-4000-8000-000000000001";
function input(
	store: Store = "bookwalker-jp",
	day = "22",
	title = "架空の書籍",
): OwnershipImport {
	const kindle = store === "kindle-jp";
	const capturedAt = `2026-09-${day}T00:00:00.000Z`;
	return {
		id: createHash("sha256")
			.update(JSON.stringify([store, day, title]))
			.digest("hex"),
		store,
		startedAt: capturedAt,
		completedAt: capturedAt,
		coverage: {
			status: kindle ? "complete" : "partial",
			scope: kindle ? "kindle-purchased-list" : "bookwalker-holdbooks",
		},
		books: [
			{
				productId: kindle ? "B000000001" : uuid,
				title,
				authorsText: "架空の著者 ほか",
				acquiredDateText: "2026/09/01 00:00購入",
				productUrl: kindle
					? "https://www.amazon.co.jp/dp/B000000001"
					: `https://bookwalker.jp/de${uuid}/`,
				evidence: {
					source: kindle
						? "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksPurchases/dateDsc"
						: "https://bookwalker.jp/holdBooks/",
					capturedAt,
					pageNumber: 1,
					kind: kindle ? "amazon-content-filter" : "bookwalker-holdbooks",
					category: kindle ? "本" : null,
					filter: kindle ? "購入済み" : null,
				},
			},
		],
	};
}
function firstBook(value: OwnershipImport) {
	const book = value.books[0];
	assert.ok(book);
	return book;
}
async function path() {
	return join(
		await mkdtemp(join(tmpdir(), "tsundoku-ownership-")),
		"library.sqlite",
	);
}

test("CLI gets either store from an isolated DB and rejects invalid store options", async () => {
	const root = await mkdtemp(join(tmpdir(), "tsundoku-cli-"));
	await cp(
		fileURLToPath(new URL("../src", import.meta.url)),
		join(root, "src"),
		{ recursive: true },
	);
	await writeFile(join(root, "package.json"), '{"type":"module"}');
	const dbPath = join(root, ".local", "library.sqlite");
	await importOwnership(input(), dbPath);
	await importOwnership(input("kindle-jp"), dbPath);
	const before = await readFile(dbPath);
	for (const [args, store] of [
		[["B000000001"], "kindle-jp"],
		[[uuid, "--store", "bookwalker-jp"], "bookwalker-jp"],
	] as const) {
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				"tsx",
				join(root, "src", "cli.ts"),
				"library",
				"get",
				...args,
			],
			{ encoding: "utf8" },
		);
		assert.ifError(result.error);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(JSON.parse(result.stdout).book.store, store);
	}
	for (const args of [
		[uuid],
		[uuid, "--store"],
		[uuid, "--store", "invalid"],
		[uuid, "--store", "bookwalker-jp", "--store", "bookwalker-jp"],
	]) {
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				"tsx",
				join(root, "src", "cli.ts"),
				"library",
				"get",
				...args,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
	}
	assert.deepEqual(await readFile(dbPath), before);
});

test("common writer stores both stores, preserves older observations and rejects timestamp conflicts", async () => {
	const dbPath = await path();
	await importOwnership(input("kindle-jp"), dbPath);
	const first = input();
	assert.equal((await importOwnership(first, dbPath)).total, 2);
	assert.equal((await importOwnership(first, dbPath)).alreadyImported, true);
	await importOwnership(input("bookwalker-jp", "23", "新しい書名"), dbPath);
	await importOwnership(input("bookwalker-jp", "21", "古い書名"), dbPath);
	assert.equal(getBook(uuid, "bookwalker-jp", dbPath)?.title, "新しい書名");
	assert.equal(
		getBook(uuid, "bookwalker-jp", dbPath)?.firstSeenAt,
		"2026-09-21T00:00:00.000Z",
	);
	assert.equal(getBook("B000000001", "kindle-jp", dbPath)?.title, "架空の書籍");
	assert.equal(searchBooks("架空", 20, 0, dbPath).total, 2);
	assert.equal(
		getBook(uuid, "bookwalker-jp", dbPath)?.ownershipEvidence?.filter,
		null,
	);
	const before = await readFile(dbPath);
	for (const day of ["21", "22", "23"])
		await assert.rejects(
			importOwnership(input("bookwalker-jp", day, "競合"), dbPath),
		);
	const collision = input();
	collision.id = input("kindle-jp").id;
	await assert.rejects(importOwnership(collision, dbPath));
	assert.deepEqual(await readFile(dbPath), before);
	readLibrary(dbPath, (db) => {
		assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
		assert.deepEqual(
			JSON.parse(
				String(
					db.prepare("SELECT coverage FROM imports WHERE id = ?").get(first.id)
						?.coverage,
				),
			),
			first.coverage,
		);
	});
});

test("invalid common input fails before creating a DB", async () => {
	for (const change of [
		(v: OwnershipImport) => {
			firstBook(v).productUrl += "?unexpected";
		},
		(v: OwnershipImport) => {
			firstBook(v).productId = "B000000001";
		},
		(v: OwnershipImport) => {
			firstBook(v).evidence.source = "https://example.com/";
		},
		(v: OwnershipImport) => {
			firstBook(v).evidence.filter = "購入済み";
		},
		(v: OwnershipImport) => {
			v.books.push(firstBook(v));
		},
		(v: OwnershipImport) => {
			v.coverage.status = "complete";
		},
		(v: OwnershipImport) => {
			firstBook(v).evidence.capturedAt = "2026-09-21T00:00:00.000Z";
		},
	]) {
		const dbPath = await path();
		const value = input();
		change(value);
		await assert.rejects(importOwnership(value, dbPath));
		await assert.rejects(access(dbPath));
	}
	assert.throws(() => getBook(uuid, "kindle-jp", "missing.sqlite"));
	assert.throws(() => getBook("B000000001", "bookwalker-jp", "missing.sqlite"));
	assert.throws(() => getBook(uuid, "unknown", "missing.sqlite"));
});

for (const version of [1, 2] as const) {
	test(`v${version} remains read-only until import, then migrates without changing legacy rows`, async () => {
		const dbPath = await path();
		const kindle = input("kindle-jp");
		await importOwnership(kindle, dbPath);
		const old = new DatabaseSync(dbPath);
		const document = JSON.stringify({
			description: "移行前の説明",
			publisher: "架空出版",
		});
		old
			.prepare("INSERT INTO metadata_snapshots VALUES (?, ?, ?, ?, ?)")
			.run(
				"legacy-metadata-hash",
				"kindle-jp",
				"B000000001",
				kindle.startedAt,
				document,
			);
		legacySchema(old, version);
		const books = old.prepare("SELECT * FROM books").all();
		const evidence = old.prepare("SELECT * FROM ownership_evidence").all();
		old.close();
		const before = await readFile(dbPath);
		assert.equal(searchBooks("架空", 20, 0, dbPath).total, 1);
		assert.equal(
			getBook("B000000001", "kindle-jp", dbPath)?.ownershipEvidence?.filter,
			"購入済み",
		);
		assert.deepEqual(await readFile(dbPath), before);
		// A failed write must also undo the migration.
		const failure = new DatabaseSync(dbPath);
		failure.exec(
			"CREATE TRIGGER reject_bw BEFORE INSERT ON books WHEN NEW.store = 'bookwalker-jp' BEGIN SELECT RAISE(ABORT, 'test'); END;",
		);
		failure.close();
		const beforeFailure = await readFile(dbPath);
		await assert.rejects(importOwnership(input(), dbPath));
		assert.deepEqual(await readFile(dbPath), beforeFailure);
		const cleanup = new DatabaseSync(dbPath);
		cleanup.exec("DROP TRIGGER reject_bw");
		cleanup.close();
		await importOwnership(input(), dbPath);
		assert.equal((await importOwnership(kindle, dbPath)).alreadyImported, true);
		readLibrary(dbPath, (db) => {
			assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 3);
			assert.deepEqual(
				db.prepare("SELECT * FROM books WHERE store = 'kindle-jp'").all(),
				books,
			);
			assert.deepEqual(
				db
					.prepare(
						"SELECT import_id, store, product_id, page_number, source, captured_at, category, filter, kind FROM ownership_evidence WHERE store = 'kindle-jp'",
					)
					.all(),
				evidence,
			);
			assert.equal(
				db.prepare("SELECT coverage FROM imports WHERE id = ?").get(kindle.id)
					?.coverage,
				null,
			);
			assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
			if (version === 2)
				assert.equal(
					db
						.prepare(
							"SELECT document FROM metadata_snapshots WHERE id = 'legacy-metadata-hash'",
						)
						.get()?.document,
					document,
				);
		});
		assert.equal(
			searchBooks("移行前の説明", 20, 0, dbPath).total,
			version === 2 ? 1 : 0,
		);
	});
}
