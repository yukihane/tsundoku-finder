import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import {
	importBookwalkerSample,
	purchasesUrl,
	readPurchasePage,
	validateLimit,
	validateSample,
} from "../src/bookwalker/purchases.js";
import { getBook, searchBooks } from "../src/library/queries.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function html({
	count = 50,
	range = "1 〜 50 件/全 80 件",
	grouped = false,
	missingSearch = false,
	duplicate = false,
} = {}) {
	return `<div id="pc-hold-books-react-root"><h2>購入済み書籍一覧 (80件)</h2>
    ${missingSearch ? "" : '<input type="text" value="架空">'}
    ${["カテゴリ", "レーベル", "出版社", "未読", "R18表示"].map((s, i) => `<select id="sortDropdownBox${i + 1}"><option selected>${s}</option></select>`).join("")}
    <a>${grouped ? "シリーズをばらして表示する" : "シリーズをまとめて表示する"}</a><p>${range}</p>
    ${Array.from({ length: count }, (_, i) => `<div class="book-txt"><h2><a href="https://bookwalker.jp/de${id(duplicate ? 1 : i + 1)}/">架空の本 ${i + 1}</a></h2><div class="book-meta">架空著者 ほか</div><p class="book-date">2026/09/01 12:30購入</p></div>`).join("")}</div>`;
}

test("BOOKWALKER extracts only the requested sample, records filters and imports offline", async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		let body = html();
		await page.route("**/*", (route) =>
			route.fulfill({ contentType: "text/html; charset=utf-8", body }),
		);
		await page.goto(purchasesUrl);
		const sample = await readPurchasePage(page, 25);
		assert.equal(sample.books.length, 25);
		assert.equal(sample.books.at(-1)?.productId, id(25));
		assert.equal(sample.evidence.rowCount, 50);
		assert.equal(sample.evidence.searchText, "架空");
		assert.equal(sample.evidence.filters.reading, "未読");
		const dir = await mkdtemp(join(tmpdir(), "tsundoku-bw-"));
		const file = join(dir, "sample.json");
		const db = join(dir, "library.sqlite");
		await writeFile(file, JSON.stringify(sample));
		assert.equal((await importBookwalkerSample(file, db)).imported, 25);
		const before = await readFile(db);
		await writeFile(file, JSON.stringify(sample, null, 2));
		assert.equal(
			(await importBookwalkerSample(file, db)).alreadyImported,
			true,
		);
		assert.equal(searchBooks("架空著者", 20, 0, db).total, 25);
		const details = getBook(id(1), "bookwalker-jp", db)?.ownershipEvidence
			?.details;
		assert.deepEqual(
			(details as { display: unknown }).display,
			sample.evidence,
		);
		assert.deepEqual(await readFile(db), before);
		for (const value of [
			{ ...sample, complete: true },
			{ ...sample, scope: "bookwalker-dom-research-sample" },
			{ ...sample, requestedLimit: 26 },
			{ ...sample, capturedAt: "invalid" },
			{ ...sample, books: sample.books.slice(0, 24) },
			{ ...sample, evidence: { ...sample.evidence, filters: {} } },
			{
				...sample,
				books: sample.books.map((b) => ({
					...b,
					productUrl: "https://example.com/",
				})),
			},
		]) {
			assert.throws(() => validateSample(value));
			await writeFile(file, JSON.stringify(value));
			const absent = join(dir, "absent.sqlite");
			await assert.rejects(importBookwalkerSample(file, absent));
			await assert.rejects(access(absent));
		}
		for (const options of [
			{ count: 49 },
			{ range: "51 〜 80 件/全 80 件", count: 30 },
			{ grouped: true },
			{ missingSearch: true },
			{ duplicate: true },
		]) {
			body = html(options);
			await page.goto(purchasesUrl);
			await assert.rejects(readPurchasePage(page, 25));
		}
		body = html();
		await page.goto("https://example.com/holdBooks/");
		await assert.rejects(readPurchasePage(page, 25));
	} finally {
		await browser.close();
	}
	for (const limit of [0, 26, 1.5, NaN])
		assert.throws(() => validateLimit(limit));
});
