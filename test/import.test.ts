import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { purchasesUrl } from "../src/kindle/purchases.js";
import {
	importKindleCollection,
	librarySummary,
	readLibrary,
} from "../src/library/database.js";
import { getBook, searchBooks } from "../src/library/queries.js";
import { importMetadata, metadataSummary } from "../src/metadata/import.js";

async function fixture(day = "22", ids = ["B000000001", "B000000002"]) {
	const directory = await mkdtemp(join(tmpdir(), "tsundoku-import-"));
	const capturedAt = `2026-09-${day}T00:00:00.000Z`;
	const range = { total: ids.length, start: 1, end: ids.length };
	const report = {
		schemaVersion: 1,
		scope: "purchased-library",
		complete: true,
		status: "completed",
		failure: null,
		startedAt: capturedAt,
		updatedAt: capturedAt,
		expectedTotal: ids.length,
		collectedCount: ids.length,
		pages: [
			{
				pageNumber: 1,
				source: purchasesUrl,
				capturedAt,
				start: 1,
				end: ids.length,
				file: "page-0001.json",
			},
		],
	};
	const page = {
		schemaVersion: 1,
		scope: "purchased-page",
		complete: false,
		requestedLimit: 25,
		source: purchasesUrl,
		capturedAt,
		observedRange: range,
		ownershipEvidence: {
			kind: "amazon-content-filter",
			category: "本",
			filter: "購入済み",
			source: purchasesUrl,
			capturedAt,
		},
		books: ids.map((asin) => ({
			asin,
			title: `架空の本 ${day}`,
			authorsText: "架空の著者 'quoted'",
			acquiredDateText: "取得日: 2026年9月1日",
			productUrl: `https://www.amazon.co.jp/dp/${asin}`,
			productUrlSource: "derived-from-asin",
			ownership: "purchased",
		})),
	};
	await writeFile(join(directory, "report.json"), JSON.stringify(report));
	await writeFile(join(directory, "page-0001.json"), JSON.stringify(page));
	return { directory, report, page };
}

test("import is idempotent, updates only newer data and never deletes missing books", async () => {
	const first = await fixture();
	const dbPath = join(first.directory, "library.sqlite");
	assert.deepEqual(await importKindleCollection(first.directory, dbPath), {
		alreadyImported: false,
		imported: 2,
		total: 2,
	});
	assert.deepEqual(await importKindleCollection(first.directory, dbPath), {
		alreadyImported: true,
		imported: 0,
		total: 2,
	});
	const newer = await fixture("23", ["B000000001"]);
	await importKindleCollection(newer.directory, dbPath);
	const older = await fixture("21", ["B000000001"]);
	await importKindleCollection(older.directory, dbPath);
	assert.deepEqual(librarySummary(dbPath), {
		books: 2,
		imports: 3,
		evidence: 4,
	});
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const book = db
			.prepare("SELECT * FROM books WHERE product_id = ?")
			.get("B000000001");
		assert.equal(book?.title, "架空の本 23");
		assert.equal(book?.authors_text, "架空の著者 'quoted'");
		assert.equal(book?.first_seen_at, "2026-09-21T00:00:00.000Z");
		assert.equal(book?.last_seen_at, "2026-09-23T00:00:00.000Z");
		assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
	} finally {
		db.close();
	}
});

test("invalid collection is rejected before opening the database", async () => {
	for (const scenario of [
		"partial",
		"path",
		"duplicate",
		"evidence",
		"range",
		"missing",
		"version",
	]) {
		const data = await fixture();
		if (scenario === "partial") data.report.complete = false;
		if (scenario === "path" && data.report.pages[0])
			data.report.pages[0].file = "../outside.json";
		if (scenario === "duplicate" && data.page.books[0] && data.page.books[1])
			data.page.books[1] = data.page.books[0];
		if (scenario === "evidence") data.page.ownershipEvidence.filter = "すべて";
		if (scenario === "range") data.page.observedRange.total = 3;
		if (scenario === "version") data.report.schemaVersion = 2;
		await writeFile(
			join(data.directory, "report.json"),
			JSON.stringify(data.report),
		);
		await writeFile(
			join(data.directory, "page-0001.json"),
			scenario === "missing" ? "{" : JSON.stringify(data.page),
		);
		const dbPath = join(data.directory, "not-created.sqlite");
		await assert.rejects(importKindleCollection(data.directory, dbPath));
		await assert.rejects(access(dbPath));
	}
});

test("SQL failure rolls back books, import record and evidence together", async () => {
	const data = await fixture();
	const dbPath = join(data.directory, "rollback.sqlite");
	await importKindleCollection(data.directory, dbPath);
	const db = new DatabaseSync(dbPath);
	db.exec(`CREATE TRIGGER reject_second BEFORE INSERT ON books
    WHEN NEW.product_id = 'B000000002' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
	db.close();
	const changed = await fixture("23");
	await assert.rejects(importKindleCollection(changed.directory, dbPath));
	assert.deepEqual(librarySummary(dbPath), {
		books: 2,
		imports: 1,
		evidence: 2,
	});
	const check = new DatabaseSync(dbPath, { readOnly: true });
	try {
		assert.equal(
			check
				.prepare("SELECT title FROM books WHERE product_id = ?")
				.get("B000000001")?.title,
			"架空の本 22",
		);
	} finally {
		check.close();
	}
});

test("search and detail are bounded, literal and read-only", async () => {
	const data = await fixture();
	const dbPath = join(data.directory, "search.sqlite");
	await importKindleCollection(data.directory, dbPath);
	const before = await readFile(dbPath);
	const first = searchBooks("架空 QUOTED", 1, 0, dbPath);
	assert.equal(first.total, 2);
	assert.equal(first.books[0]?.productId, "B000000001");
	assert.equal(first.nextOffset, 1);
	const second = searchBooks("架空 QUOTED", 1, 1, dbPath);
	assert.equal(second.books[0]?.productId, "B000000002");
	assert.equal(second.nextOffset, null);
	assert.equal(searchBooks("", 20, 0, dbPath).total, 2);
	for (const term of ["%", "_", "' OR 1=1 --", "存在しない"]) {
		assert.equal(searchBooks(term, 20, 0, dbPath).total, 0);
	}
	assert.equal(searchBooks("'quoted'", 20, 0, dbPath).total, 2);
	assert.equal(searchBooks("", 20, 10, dbPath).books.length, 0);
	assert.equal(
		getBook("B000000001", "kindle-jp", dbPath)?.ownershipEvidence?.filter,
		"購入済み",
	);
	assert.equal(getBook("B999999999", "kindle-jp", dbPath), null);
	assert.throws(() => searchBooks("", 101, 0, dbPath));
	assert.throws(() => searchBooks("", 1, -1, dbPath));
	assert.throws(() => getBook("invalid", "kindle-jp", dbPath));
	assert.throws(() =>
		readLibrary(dbPath, (db) => db.exec("DELETE FROM books")),
	);
	assert.deepEqual(await readFile(dbPath), before);
	const missing = join(data.directory, "missing.sqlite");
	assert.throws(() => searchBooks("", 20, 0, missing));
	await assert.rejects(access(missing));
});

test("metadata migrates v1 offline, preserves history and searches newest snapshot", async () => {
	const data = await fixture();
	const dbPath = join(data.directory, "metadata.sqlite");
	await importKindleCollection(data.directory, dbPath);
	const old = new DatabaseSync(dbPath);
	old.exec(
		"DROP VIEW latest_metadata; DROP TABLE metadata_snapshots; PRAGMA user_version = 1;",
	);
	old.close();
	assert.equal(searchBooks("架空", 20, 0, dbPath).total, 2);
	assert.equal(metadataSummary(dbPath).pending, 2);
	const filename = join(data.directory, "metadata.json");
	const snapshot = {
		schemaVersion: 1,
		scope: "kindle-metadata-sample",
		store: "kindle-jp",
		productId: "B000000001",
		source: "https://www.amazon.co.jp/dp/B000000001",
		capturedAt: "2026-09-22T00:00:00.000Z",
		title: "書誌名",
		authorsText: "著者 (著) 形式: Kindle版",
		publisher: "試験出版",
		description: "立体造形の解説",
		publicationDateText: null,
		categories: ["コンピュータ"],
		series: null,
		missingFields: ["series"],
	};
	await writeFile(filename, JSON.stringify(snapshot));
	assert.deepEqual(await importMetadata(filename, dbPath), {
		alreadyImported: false,
	});
	assert.deepEqual(await importMetadata(filename, dbPath), {
		alreadyImported: true,
	});
	assert.equal(searchBooks("立体造形", 20, 0, dbPath).total, 1);
	assert.deepEqual(
		getBook("B000000001", "kindle-jp", dbPath)?.metadata,
		snapshot,
	);
	assert.equal(searchBooks("コンピュータ", 20, 0, dbPath, "試験出版").total, 1);
	assert.equal(searchBooks("", 20, 0, dbPath, "別出版").total, 0);
	assert.equal(searchBooks("' OR 1=1 --", 20, 0, dbPath).total, 0);
	assert.equal(searchBooks("", 1, 0, dbPath).books[0]?.title, "架空の本 22");
	await writeFile(
		filename,
		JSON.stringify({
			...snapshot,
			capturedAt: "2026-09-21T00:00:00.000Z",
			description: "古い説明",
		}),
	);
	await importMetadata(filename, dbPath);
	assert.equal(searchBooks("古い説明", 20, 0, dbPath).total, 0);
	await writeFile(
		filename,
		JSON.stringify({ ...snapshot, description: "同時刻の競合" }),
	);
	await assert.rejects(importMetadata(filename, dbPath));
	await writeFile(
		filename,
		JSON.stringify({
			...snapshot,
			capturedAt: "2026-09-23T00:00:00.000Z",
			description: null,
			missingFields: ["description", "series"],
		}),
	);
	await importMetadata(filename, dbPath);
	assert.equal(searchBooks("立体造形", 20, 0, dbPath).total, 0);
	assert.equal(searchBooks("試験出版", 20, 0, dbPath).total, 1);
	assert.deepEqual(metadataSummary(dbPath), {
		total: 2,
		captured: 1,
		pending: 1,
		snapshots: 3,
	});
	assert.deepEqual(librarySummary(dbPath), {
		books: 2,
		imports: 1,
		evidence: 2,
	});
});

test("invalid or unowned metadata does not migrate or alter database", async () => {
	const data = await fixture();
	const dbPath = join(data.directory, "rejected.sqlite");
	await importKindleCollection(data.directory, dbPath);
	const old = new DatabaseSync(dbPath);
	old.exec(
		"DROP VIEW latest_metadata; DROP TABLE metadata_snapshots; PRAGMA user_version = 1;",
	);
	old.close();
	const before = await readFile(dbPath);
	const filename = join(data.directory, "metadata.json");
	const value = {
		schemaVersion: 1,
		scope: "kindle-metadata-sample",
		store: "kindle-jp",
		productId: "B999999999",
		source: "https://www.amazon.co.jp/dp/B999999999",
		capturedAt: "2026-09-22T00:00:00.000Z",
		title: "架空",
		authorsText: "著者 形式: Kindle版",
		publisher: null,
		description: null,
		publicationDateText: null,
		categories: [],
		series: null,
		missingFields: ["publisher", "description", "categories", "series"],
	};
	for (const input of [
		value,
		{ ...value, source: "https://example.com" },
		{ ...value, missingFields: [] },
		{ ...value, capturedAt: "invalid" },
		{ ...value, categories: [1] },
		{ ...value, schemaVersion: 2 },
	]) {
		await writeFile(filename, JSON.stringify(input));
		await assert.rejects(importMetadata(filename, dbPath));
		assert.deepEqual(await readFile(dbPath), before);
	}
	const missingDb = join(data.directory, "missing-db.sqlite");
	await writeFile(filename, JSON.stringify(value));
	await assert.rejects(importMetadata(filename, missingDb));
	await assert.rejects(access(missingDb));
});

test("foreign database remains unchanged", async () => {
	const data = await fixture();
	const dbPath = join(data.directory, "foreign.sqlite");
	const db = new DatabaseSync(dbPath);
	db.exec("CREATE TABLE unrelated (value TEXT)");
	db.close();
	const before = await readFile(dbPath);
	await assert.rejects(importKindleCollection(data.directory, dbPath));
	assert.deepEqual(await readFile(dbPath), before);
});
