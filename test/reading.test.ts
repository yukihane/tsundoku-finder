import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { readReadingSample } from "../src/kindle/reading.js";
import { purchasesUrl } from "../src/kindle/source.js";

test("reading sample associates visible badges per book and never infers unread", async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		const badges = [
			'<div id="content-read-badge">読んだ本</div>',
			"",
			'<div id="content-read-badge" hidden>読んだ本</div>',
			'<div id="content-read-badge">未知の表示</div>',
			'<div id="content-read-badge">読んだ本</div><div id="content-read-badge">読んだ本</div>',
			'<div id="content-read-badge">読んだ本</div>',
		];
		const html = `<div id="ContentCategoryDropDown"><div class="drop-down-text">本</div></div>
		<div id="ContentSubCategoryDropDown"><div class="drop-down-text">購入済み</div></div>
		<input id="content-search-box" value="">
		<div id="CONTENT_COUNT">6のうち1から6までの商品を表示しています</div>
		${badges
			.map(
				(badge, i) => `<div class="digital_entity_details">
		<div id="content-title-B00000000${i + 1}">読んだ本という架空の書名</div>
		<div id="content-acquired-date-B00000000${i + 1}">取得日: 2026年9月1日</div>${badge}</div>`,
			)
			.join("")}`;
		await page.route("**/*", (route) =>
			route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
		);
		await page.goto(purchasesUrl);
		const report = await readReadingSample(page, 6);
		assert.deepEqual(
			report.books.map((book) => book.kindleReadState),
			["read", "unknown", "unknown", "unknown", "unknown", "read"],
		);
		assert.deepEqual(
			report.books.map((book) => book.asin),
			badges.map((_, i) => `B00000000${i + 1}`),
		);
		assert.equal(report.books[3]?.observedLabel, "未知の表示");
		assert.equal(report.scope, "reading-state-sample");
		assert.equal(report.complete, false);
		assert.equal((await readReadingSample(page, 1)).books.length, 1);
		await page
			.locator(".digital_entity_details")
			.first()
			.evaluate((el) => el.setAttribute("class", "changed"));
		assert.equal(
			(await readReadingSample(page, 1)).books[0]?.kindleReadState,
			"unknown",
		);
		await page.goto(purchasesUrl.replace("booksPurchases", "booksAll"));
		await assert.rejects(readReadingSample(page, 1));
	} finally {
		await browser.close();
	}
});
