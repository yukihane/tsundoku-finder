import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { chromium } from "playwright";
import { bookwalkerAdapter } from "../src/bookwalker/adapter.js";
import { readBookwalkerMetadata } from "../src/bookwalker/metadata.js";
import { importOwnership } from "../src/library/database.js";
import { getBook, searchBooks } from "../src/library/queries.js";
import { importMetadata, validateMetadata } from "../src/metadata/import.js";
import { createStoreRegistry } from "../src/stores/registry.js";

const id = "00000000-0000-4000-8000-000000000001";
const url = bookwalkerAdapter.productUrl(id);
const stamp = "2026-09-22T00:00:00.000Z";
const html = `<h1 class="t-c-product-main-data__title">架空の書名</h1><a href="${url}">架空の書名</a>
<dl class="t-c-detail-about-information__data">
<dt>著者</dt><dd>架空著者 (漫画) 原作者 (原作)</dd>
<dt>出版社</dt><dd>試験出版</dd><dt>レーベル</dt><dd>レーベル限定語</dd>
<dt>配信開始日</dt><dd>2026/09/01</dd>
<dt>カテゴリ</dt><dd><a>マンガ</a></dd>
<dt>シリーズ</dt><dd><a href="https://bookwalker.jp/series/123/list/?ref=test">架空シリーズ</a></dd></dl>
<div id="detail-synopsis-main"><p class="t-c-synopsis-accordion__text">紹介文限定語</p></div>
<ul class="t-c-detail-about-genre__tag-list"><li><a>ジャンル限定語</a></li></ul>
<aside><h3>別商品</h3><dl><dt>出版社</dt><dd>別出版社</dd></dl><p class="t-c-synopsis-accordion__text">別商品の紹介</p></aside>`;

test("BOOKWALKER metadata isolates product fields and flows through shared storage/search", async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		let body = html;
		await page.route("**/*", (route) =>
			route.fulfill({ contentType: "text/html; charset=utf-8", body }),
		);
		await page.goto(url);
		const report = await readBookwalkerMetadata(page, id);
		assert.equal(report.publisher, "試験出版");
		assert.equal(report.description, "紹介文限定語");
		assert.equal(report.publicationDateText, null);
		assert.equal(report.distributionDateText, "2026/09/01");
		assert.equal(report.series?.url, "https://bookwalker.jp/series/123/list/");
		assert.deepEqual(report.missingFields, []);
		const dir = await mkdtemp(join(tmpdir(), "tsundoku-bw-metadata-"));
		const dbPath = join(dir, "library.sqlite");
		const file = join(dir, "metadata.json");
		await importOwnership(
			{
				id: "a".repeat(64),
				store: "bookwalker-jp",
				startedAt: stamp,
				completedAt: stamp,
				coverage: { status: "partial", scope: "bookwalker-holdbooks" },
				books: [
					{
						productId: id,
						title: "所有一覧の書名",
						authorsText: "一覧著者",
						acquiredDateText: "2026/09/01",
						productUrl: url,
						evidence: {
							source: "https://bookwalker.jp/holdBooks/",
							capturedAt: stamp,
							pageNumber: 1,
							category: null,
							filter: null,
							kind: "bookwalker-holdbooks",
						},
					},
				],
			},
			dbPath,
		);
		await writeFile(file, JSON.stringify(report));
		assert.equal((await importMetadata(file, dbPath)).alreadyImported, false);
		assert.equal((await importMetadata(file, dbPath)).alreadyImported, true);
		assert.equal(getBook(id, "bookwalker-jp", dbPath)?.title, "所有一覧の書名");
		assert.deepEqual(getBook(id, "bookwalker-jp", dbPath)?.metadata, report);
		for (const term of [
			"紹介文限定語",
			"ジャンル限定語",
			"レーベル限定語",
			"架空シリーズ",
			"原作者",
		])
			assert.equal(searchBooks(term, 20, 0, dbPath, "試験出版").total, 1);
		assert.equal(searchBooks("別商品の紹介", 20, 0, dbPath).total, 0);
		const before = await readFile(dbPath);
		for (const invalid of [
			{ ...report, description: "同時刻競合" },
			{ ...report, source: "https://example.com/" },
			{ ...report, store: "unknown" },
			{
				...report,
				productId: id.replace(/1$/, "2"),
				source: url.replace(/1\/$/, "2/"),
			},
			{
				...report,
				series: { text: "不正", url: "https://example.com/series" },
			},
		]) {
			await writeFile(file, JSON.stringify(invalid));
			await assert.rejects(importMetadata(file, dbPath));
			assert.deepEqual(await readFile(dbPath), before);
		}
		const later = {
			...report,
			capturedAt: new Date(
				Date.parse(String(report.capturedAt)) + 1000,
			).toISOString(),
			description: null,
			genres: [],
			label: null,
			missingFields: ["description"],
		};
		await writeFile(file, JSON.stringify(later));
		await importMetadata(file, dbPath);
		assert.equal(searchBooks("紹介文限定語", 20, 0, dbPath).total, 0);
		assert.equal(searchBooks("ジャンル限定語", 20, 0, dbPath).total, 0);
		for (const changed of [
			html.replace("出版社</dt>", "出版社</dt><dd>重複</dd><dt>出版社</dt>"),
			html.replace('class="t-c-product-main-data__title"', 'class="missing"'),
			html.replace(`href="${url}"`, 'href="https://example.com/"'),
		]) {
			body = changed;
			await page.reload();
			await assert.rejects(readBookwalkerMetadata(page, id));
		}
		body = html;
		await page.goto("https://example.com/");
		await assert.rejects(readBookwalkerMetadata(page, id));
	} finally {
		await browser.close();
	}
});

test("a registered third metadata adapter uses common validation and SQL without store branches", async () => {
	const adapter = {
		...bookwalkerAdapter,
		id: "fictional-store",
		command: "fictional",
		metadataScope: "fictional-metadata",
		isProductId: (value: string) => value === "SKU-123",
		productUrl: (value: string) => `https://example.invalid/${value}`,
		validateMetadataFormat: () => {},
	};
	const registry = createStoreRegistry([adapter]);
	assert.throws(() => createStoreRegistry([adapter, adapter]));
	assert.throws(() => registry.get("unknown"));
	const value = {
		schemaVersion: 1,
		scope: adapter.metadataScope,
		store: adapter.id,
		productId: "SKU-123",
		source: adapter.productUrl("SKU-123"),
		capturedAt: stamp,
		title: "第三ストア書誌",
		authorsText: "第三著者",
		publisher: null,
		publicationDateText: null,
		description: "第三ストア説明",
		categories: [],
		series: null,
		missingFields: ["publisher", "categories", "series"],
	};
	assert.equal(validateMetadata(value, registry).store, adapter.id);
	assert.throws(() => validateMetadata(value));
	const dir = await mkdtemp(join(tmpdir(), "tsundoku-adapter-"));
	const dbPath = join(dir, "library.sqlite");
	// Owned input remains separately constrained: seed this fictional ownership in SQL for this metadata-only test.
	const { initialize } = await import("../src/library/database.js");
	const db = new DatabaseSync(dbPath);
	db.exec("BEGIN");
	initialize(db);
	db.prepare("INSERT INTO imports VALUES (?,?,?,?,?,?,?)").run(
		"fictional",
		adapter.id,
		stamp,
		stamp,
		stamp,
		1,
		"{}",
	);
	db.prepare("INSERT INTO books VALUES (?,?,?,?,?,?,?,?,?,?)").run(
		adapter.id,
		"SKU-123",
		"所有商品",
		"著者",
		"日付",
		value.source,
		"purchased",
		stamp,
		stamp,
		"fictional",
	);
	db.exec("COMMIT");
	db.close();
	const file = join(dir, "metadata.json");
	await writeFile(file, JSON.stringify(value));
	await importMetadata(file, dbPath, registry);
	assert.equal(searchBooks("第三ストア説明", 20, 0, dbPath).total, 1);
});
