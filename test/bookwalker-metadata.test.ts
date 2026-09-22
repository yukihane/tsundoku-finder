import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { bookwalkerAdapter } from "../src/bookwalker/adapter.js";
import { readBookwalkerMetadata } from "../src/bookwalker/metadata.js";
import { importOwnership } from "../src/library/database.js";
import type { OwnershipImport } from "../src/library/ownership.js";
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

test("BOOKWALKER handles latest badges, short synopses and missing optional fields", async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		let body =
			html.replace("架空の書名</h1>", "【最新刊】架空の書名</h1>") +
			'<button style="display:none" aria-controls="detail-synopsis-main" aria-expanded="false">あらすじを読む</button>';
		await page.route("**/*", (route) =>
			route.fulfill({ contentType: "text/html; charset=utf-8", body }),
		);
		await page.goto(url);
		await bookwalkerAdapter.waitForMetadata(page);
		const report = await readBookwalkerMetadata(page, id);
		assert.equal(report.title, "【最新刊】架空の書名");
		assert.equal(report.description, "紹介文限定語");
		body = body.replace("架空の書名</a>", "別の書名</a>");
		await page.reload();
		await assert.rejects(readBookwalkerMetadata(page, id));
		body = `<h1 class="t-c-product-main-data__title">架空の書名</h1><a href="${url}">架空の書名</a><dl class="t-c-detail-about-information__data"><dt>著者</dt><dd>架空著者</dd></dl>`;
		await page.reload();
		await bookwalkerAdapter.waitForMetadata(page);
		const missing = await readBookwalkerMetadata(page, id);
		assert.deepEqual(missing.missingFields, [
			"publisher",
			"description",
			"categories",
			"series",
		]);
		assert.equal(missing.label, null);
		assert.equal(missing.distributionDateText, null);
		assert.deepEqual(missing.genres, []);
	} finally {
		await browser.close();
	}
});

test("a registered third adapter imports ownership and metadata through shared storage and queries", async () => {
	const adapter = {
		...bookwalkerAdapter,
		id: "fictional-store",
		command: "fictional",
		metadataScope: "fictional-metadata",
		isProductId: (value: string) => value === "SKU-123",
		productUrl: (value: string) => `https://example.invalid/${value}`,
		validateMetadataFormat: () => {},
		validateOwnership(input: OwnershipImport) {
			if (
				input.coverage.scope !== "fictional-library" ||
				input.coverage.status !== "complete"
			)
				throw new Error("Invalid coverage");
			for (const b of input.books) {
				const e = b.evidence;
				if (
					e.source !== "https://example.invalid/library" ||
					e.kind !== "fictional-purchase" ||
					e.category !== null ||
					e.filter !== "owned" ||
					e.display?.accountType !== "personal"
				)
					throw new Error("Invalid evidence");
			}
		},
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
	const ownership: OwnershipImport = {
		id: "f".repeat(64),
		store: adapter.id,
		startedAt: stamp,
		completedAt: stamp,
		coverage: { status: "complete", scope: "fictional-library" },
		books: [
			{
				productId: "SKU-123",
				title: "所有商品",
				authorsText: "著者",
				acquiredDateText: "2026/09/22",
				productUrl: value.source,
				evidence: {
					source: "https://example.invalid/library",
					capturedAt: stamp,
					pageNumber: 1,
					kind: "fictional-purchase",
					category: null,
					filter: "owned",
					display: { accountType: "personal" },
				},
			},
		],
	};
	const book = ownership.books[0];
	assert.ok(book);
	for (const invalid of [
		{ ...ownership, store: "unknown" },
		{
			...ownership,
			coverage: { ...ownership.coverage, status: "partial" as const },
		},
		{
			...ownership,
			coverage: { ...ownership.coverage, scope: "bookwalker-holdbooks" },
		},
		{
			...ownership,
			books: [{ ...book, productUrl: "https://example.invalid/wrong" }],
		},
		{ ...ownership, books: [{ ...book, productId: "BAD" }] },
		{
			...ownership,
			books: [
				{
					...book,
					evidence: {
						...book.evidence,
						source: "https://example.invalid/not-owned",
					},
				},
			],
		},
		{
			...ownership,
			books: [
				{
					...book,
					evidence: { ...book.evidence, kind: "bookwalker-holdbooks" },
				},
			],
		},
		{
			...ownership,
			books: [
				{
					...book,
					evidence: { ...book.evidence, display: { accountType: "unknown" } },
				},
			],
		},
		{ ...ownership, books: [book, book] },
	]) {
		await assert.rejects(importOwnership(invalid, dbPath, registry));
		await assert.rejects(access(dbPath));
	}
	await assert.rejects(importOwnership(ownership, dbPath));
	await assert.rejects(access(dbPath));
	assert.equal(
		(await importOwnership(ownership, dbPath, registry)).imported,
		1,
	);
	assert.equal(
		(await importOwnership(ownership, dbPath, registry)).alreadyImported,
		true,
	);
	assert.equal(searchBooks("所有商品", 20, 0, dbPath).total, 1);
	const owned = getBook("SKU-123", adapter.id, dbPath, registry);
	assert.ok(owned?.ownershipEvidence);
	assert.deepEqual(
		(owned.ownershipEvidence.details as { display: unknown }).display,
		{ accountType: "personal" },
	);
	assert.throws(() => getBook("SKU-123", adapter.id, dbPath));
	assert.throws(() => getBook("BAD", adapter.id, dbPath, registry));
	const before = await readFile(dbPath);
	await assert.rejects(
		importOwnership(
			{ ...ownership, id: "e".repeat(64), books: [{ ...book, title: "競合" }] },
			dbPath,
			registry,
		),
	);
	assert.deepEqual(await readFile(dbPath), before);
	const file = join(dir, "metadata.json");
	await writeFile(file, JSON.stringify(value));
	await importMetadata(file, dbPath, registry);
	assert.equal(searchBooks("第三ストア説明", 20, 0, dbPath).total, 1);
	assert.deepEqual(
		getBook("SKU-123", adapter.id, dbPath, registry)?.metadata,
		validateMetadata(value, registry),
	);
	assert.deepEqual(
		getBook("SKU-123", adapter.id, dbPath, registry)?.ownershipEvidence,
		owned?.ownershipEvidence,
	);
});
