import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { chromium } from "playwright";
import { dmmAdapter } from "../src/dmm/adapter.js";
import { shelfUrl, volumeUrl } from "../src/dmm/identity.js";
import {
	importDmmSample,
	toOwnership,
	validateSample,
} from "../src/dmm/import.js";
import { readDmmMetadata } from "../src/dmm/metadata.js";
import {
	collectSample,
	readShelf,
	readVolumePage,
} from "../src/dmm/purchases.js";
import { importOwnership, readLibrary } from "../src/library/database.js";
import { getBook, searchBooks } from "../src/library/queries.js";
import { importMetadata } from "../src/metadata/import.js";

const stamp = "2026-09-22T00:00:00.000Z";
const url = "https://book.dmm.com/product/100/test00001/";
function shelfHtml() {
	return `<div id="root"><div data-testid="filter-label">全年齢 / R18すべて</div><div data-testid="filter-label">購入済みすべて</div>
<li data-is-selected="true">全年齢 / R18すべて</li><li data-is-selected="true">購入済みすべて</li>
<i data-testid="icon-checkbox" data-name="orangeBoldSquareOn"></i><input placeholder="作品名、作家名及び出演者名などで検索できます" value="">
<button data-testid="sort-button"><li data-active="true">購入日が新しい順</li></button>
<main><h1>本棚</h1><p>1〜1件/全1件</p><ul data-e2e="library"><li><div data-testid="library-book-authors">架空著者 ほか</div><a href="${volumeUrl("100")}">単行本一覧</a></li></ul></main></div>`;
}
function volumesHtml() {
	return `<main><h1 data-testid="series-title-header">架空シリーズ（全2冊）</h1><div data-testid="volume-general-tab-list"><span data-testid="tab-header-item" data-active="true">購入済み</span></div><p>1〜2件/全2件</p>
${[1, 2].map((n) => `<div data-testid="purchased-volume-book"><span data-outlined="outlined">購入済み</span><a data-is-limited="false" href="/product/100/${n === 2 ? "latest" : "test00001"}/">架空の本 ${n}</a><a href="https://book.dmm.com/download/?product_id=test0000${n}&shop=gbook&content_type=download&content_domain=dmm.com">作品をダウンロードする</a><a href="https://review.dmm.com/review-front/review/posting?content_id=test0000${n}&shop_name=digital_gbook">レビューを書く</a></div>`).join("")}</main>`;
}
const metadataHtml = `<link rel="canonical" href="${url}"><main><h1>架空の本 1</h1><div data-testid="detail-book"><span data-testid="description-text">紹介文限定語</span></div><section>
<dl><dt>シリーズ名</dt><dd><a data-testid="volume-detail-info" href="${url}">架空シリーズ</a></dd></dl>
<dl><dt>作家</dt><dd>架空著者 著</dd></dl><dl><dt>出版社</dt><dd>試験出版</dd></dl>
<dl><dt>掲載誌・レーベル</dt><dd>レーベル限定語</dd></dl><dl><dt>カテゴリー</dt><dd><a>技術書</a></dd></dl>
<dl><dt>ジャンル</dt><dd><a>ジャンル限定語</a></dd></dl><dl><dt>配信開始日</dt><dd>2026/09/01 00:00</dd></dl>
</section><aside><dl><dt>出版社</dt><dd>混入してはいけない出版社</dd></dl><span data-testid="description-text">無関係な説明</span></aside></main>`;

test("DMM DOM collection, offline import, metadata and search preserve individual purchased volumes", async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		const visited: string[] = [];
		let productHtml = metadataHtml;
		await page.route("**/*", (route) => {
			const request = route.request().url();
			visited.push(request);
			return route.fulfill({
				contentType: "text/html; charset=utf-8",
				body:
					request === shelfUrl
						? shelfHtml()
						: request === volumeUrl("100")
							? volumesHtml()
							: productHtml,
			});
		});
		await page.goto(shelfUrl);
		const sample = await collectSample(page, 25);
		assert.equal(sample.pages.length, 1);
		const input = toOwnership(sample);
		assert.deepEqual(
			input.books.map((b) => b.productId),
			["test00001", "test00002"],
		);
		assert.equal(
			input.books[1]?.productUrl,
			"https://book.dmm.com/product/100/test00002/",
		);
		assert.equal(input.books[0]?.acquiredDateText, null);
		assert.equal(
			visited.some(
				(u) =>
					u.includes("download") ||
					u.includes("review") ||
					u.includes("streaming"),
			),
			false,
		);
		const dir = await mkdtemp(join(tmpdir(), "tsundoku-dmm-"));
		const file = join(dir, "sample.json");
		const db = join(dir, "library.sqlite");
		await writeFile(file, JSON.stringify(sample));
		assert.equal((await importDmmSample(file, db)).imported, 2);
		const before = await readFile(db);
		await writeFile(file, JSON.stringify(sample, null, 2));
		assert.equal((await importDmmSample(file, db)).alreadyImported, true);
		assert.deepEqual(await readFile(db), before);
		assert.equal(searchBooks("架空著者", 20, 0, db).total, 2);
		assert.equal(getBook("test00002", "dmm-books", db)?.acquiredDateText, null);
		await page.goto(url);
		await dmmAdapter.waitForMetadata(page);
		const report = await readDmmMetadata(page, "test00001");
		assert.equal(report.publisher, "試験出版");
		assert.equal(report.publicationDateText, null);
		assert.equal(report.distributionDateText, "2026/09/01 00:00");
		const metadata = join(dir, "metadata.json");
		await writeFile(metadata, JSON.stringify(report));
		await importMetadata(metadata, db);
		assert.equal((await importMetadata(metadata, db)).alreadyImported, true);
		for (const term of [
			"紹介文限定語",
			"ジャンル限定語",
			"レーベル限定語",
			"架空シリーズ",
		])
			assert.equal(searchBooks(term, 20, 0, db, "試験出版").total, 1);
		assert.equal(searchBooks("無関係な説明", 20, 0, db).total, 0);
		assert.deepEqual(getBook("test00001", "dmm-books", db)?.metadata, report);
		const captured = await readFile(db);
		await writeFile(
			metadata,
			JSON.stringify({
				...report,
				source: report.source.replace("/100/", "/200/"),
			}),
		);
		await assert.rejects(importMetadata(metadata, db));
		assert.deepEqual(await readFile(db), captured);
		await writeFile(
			metadata,
			JSON.stringify({ ...report, description: "同時刻の競合" }),
		);
		await assert.rejects(importMetadata(metadata, db));
		assert.deepEqual(await readFile(db), captured);
		for (const body of [
			metadataHtml.replace(url, "https://example.com/"),
			metadataHtml.replace("<h1>", "<h1>別の見出し</h1><h1>"),
			metadataHtml.replace(
				"<dt>出版社</dt>",
				"<dt>出版社</dt><dd>重複</dd></dl><dl><dt>出版社</dt>",
			),
			"<h1>ログイン</h1>",
		]) {
			productHtml = body;
			await page.reload();
			await assert.rejects(readDmmMetadata(page, "test00001"));
		}
		const conflict = structuredClone(input);
		conflict.id = "f".repeat(64);
		assert.ok(conflict.books[1]);
		conflict.books[1].title = "同時刻変更";
		await assert.rejects(importOwnership(conflict, db));
		assert.deepEqual(await readFile(db), captured);
		readLibrary(db, (conn) => {
			assert.deepEqual(conn.prepare("PRAGMA foreign_key_check").all(), []);
			assert.equal(
				conn.prepare("PRAGMA integrity_check").get()?.integrity_check,
				"ok",
			);
		});
	} finally {
		await browser.close();
	}
});

test("DMM rejects invalid scope, IDs, evidence, counts and authentication before opening DB", async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		let body = shelfHtml();
		await page.route("**/*", (r) =>
			r.fulfill({ contentType: "text/html; charset=utf-8", body }),
		);
		await page.goto(shelfUrl);
		const shelf = await readShelf(page);
		for (const invalid of [
			shelfHtml().replace("1〜1件/全1件", "2〜2件/全2件"),
			shelfHtml().replace('value=""', 'value="検索中"'),
			shelfHtml().replace("全年齢 / R18すべて", "R18のみ"),
			"<h1>ログイン</h1>",
		]) {
			body = invalid;
			await page.reload();
			await assert.rejects(readShelf(page));
		}
		body = volumesHtml();
		await page.goto(volumeUrl("100"));
		const p = await readVolumePage(page);
		const sample = {
			schemaVersion: 1,
			scope: "dmm-purchased-sample",
			store: "dmm-books",
			complete: false,
			requestedLimit: 25,
			startedAt: stamp,
			completedAt: p.capturedAt,
			shelf,
			pages: [p],
		};
		validateSample(sample);
		const invalids = [
			{ ...sample, complete: true },
			{ ...sample, requestedLimit: 26 },
			{ ...sample, pages: [] },
			{ ...sample, pages: [{ ...p, rowCount: 3 }] },
			{ ...sample, pages: [{ ...p, selectedTabs: ["すべて"] }] },
			{ ...sample, pages: [{ ...p, books: [p.books[0], p.books[0]] }] },
		];
		const dir = await mkdtemp(join(tmpdir(), "tsundoku-dmm-invalid-"));
		const file = join(dir, "sample.json");
		const absent = join(dir, "absent.sqlite");
		for (const bad of invalids) {
			assert.throws(() => validateSample(bad));
			await writeFile(file, JSON.stringify(bad));
			await assert.rejects(importDmmSample(file, absent));
			await assert.rejects(access(absent));
		}
		for (const invalid of [
			volumesHtml().replace("content_id=test00001", "content_id=wrong00001"),
			volumesHtml().replace("product_id=test00001", "product_id=test00002"),
			volumesHtml().replace("購入済み</span>", "未購入</span>"),
			volumesHtml().replace("1〜2件/全2件", "1〜3件/全3件"),
			volumesHtml().replace(
				"/product/100/test00001/",
				"/product/200/test00001/",
			),
		]) {
			body = invalid;
			await page.reload();
			await assert.rejects(readVolumePage(page));
		}
		body = volumesHtml();
		await page.goto("https://example.com/");
		await assert.rejects(readVolumePage(page));
	} finally {
		await browser.close();
	}
});

test("v3 upgrade preserves rows and metadata and is transactional", async () => {
	const dir = await mkdtemp(join(tmpdir(), "tsundoku-dmm-v3-"));
	const path = join(dir, "library.sqlite");
	const db = new DatabaseSync(path);
	// A minimal real v3 schema, with all foreign-key dependencies exercised.
	db.exec(`PRAGMA application_id=1414745668; PRAGMA user_version=3;
CREATE TABLE imports(id TEXT PRIMARY KEY,source_store TEXT NOT NULL,started_at TEXT NOT NULL,completed_at TEXT NOT NULL,imported_at TEXT NOT NULL,book_count INTEGER NOT NULL,coverage TEXT) STRICT;
CREATE TABLE books(store TEXT NOT NULL,product_id TEXT NOT NULL,title TEXT NOT NULL,authors_text TEXT NOT NULL,acquired_date_text TEXT NOT NULL,product_url TEXT NOT NULL,ownership TEXT NOT NULL,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,latest_import_id TEXT NOT NULL REFERENCES imports(id),PRIMARY KEY(store,product_id)) STRICT;
CREATE TABLE ownership_evidence(import_id TEXT NOT NULL REFERENCES imports(id),store TEXT NOT NULL,product_id TEXT NOT NULL,page_number INTEGER NOT NULL,source TEXT NOT NULL,captured_at TEXT NOT NULL,category TEXT,filter TEXT,kind TEXT NOT NULL,details TEXT NOT NULL,PRIMARY KEY(import_id,store,product_id),FOREIGN KEY(store,product_id) REFERENCES books(store,product_id)) STRICT;
CREATE TABLE metadata_snapshots(id TEXT PRIMARY KEY,store TEXT NOT NULL,product_id TEXT NOT NULL,captured_at TEXT NOT NULL,document TEXT NOT NULL,UNIQUE(store,product_id,captured_at),FOREIGN KEY(store,product_id) REFERENCES books(store,product_id)) STRICT;
CREATE VIEW latest_metadata AS SELECT * FROM metadata_snapshots;
INSERT INTO imports VALUES('old','kindle-jp','${stamp}','${stamp}','${stamp}',1,NULL);
INSERT INTO books VALUES('kindle-jp','B000000001','既存本','既存著者','2026/09/01','https://www.amazon.co.jp/dp/B000000001','purchased','${stamp}','${stamp}','old');
INSERT INTO ownership_evidence VALUES('old','kindle-jp','B000000001',1,'source','${stamp}',NULL,NULL,'old','{}');
INSERT INTO metadata_snapshots VALUES('meta','kindle-jp','B000000001','${stamp}','{"description":"既存説明"}');`);
	db.close();
	const { initialize } = await import("../src/library/database.js");
	const before = await readFile(path);
	const writable = new DatabaseSync(path, {
		enableForeignKeyConstraints: true,
	});
	writable.exec("BEGIN IMMEDIATE");
	initialize(writable);
	assert.equal(writable.prepare("SELECT count(*) AS n FROM books").get()?.n, 1);
	assert.deepEqual(writable.prepare("PRAGMA foreign_key_check").all(), []);
	writable.exec("ROLLBACK");
	writable.close();
	assert.deepEqual(await readFile(path), before);
	const upgrade = new DatabaseSync(path, { enableForeignKeyConstraints: true });
	upgrade.exec("BEGIN IMMEDIATE");
	initialize(upgrade);
	upgrade.exec("COMMIT");
	assert.equal(
		upgrade.prepare("SELECT document FROM latest_metadata").get()?.document,
		'{"description":"既存説明"}',
	);
	assert.equal(upgrade.prepare("PRAGMA user_version").get()?.user_version, 4);
	upgrade.close();
});
