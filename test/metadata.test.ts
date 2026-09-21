import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { readKindleMetadata } from "../src/metadata/kindle.js";

test("metadata requires matching product identity and excludes unrelated page content", async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		let html = `<div id="centerCol"><span id="productTitle">架空の本</span>
      <div id="bylineInfo">架空の著者 (著) 形式: Kindle版</div>
      <div id="bookDescription_feature_div"><div class="a-expander-content">架空の紹介文</div></div></div>
      <div id="detailBulletsWrapper_feature_div"><ul><li>ASIN ‏ : ‎ B000000001</li><li>出版社 : 架空出版</li><li>発売日 : 2026/9/22</li></ul></div>
      <div id="wayfinding-breadcrumbs_feature_div"><a>Kindle本</a><a>マンガ</a></div>
      <div id="seriesBulletWidget_feature_div"><a href="/dp/B000000099?ref=test">全3巻中第1巻: 架空シリーズ</a></div>
      <aside>広告 出版社 : 別の出版社 <div class="a-expander-content">広告の説明</div></aside>`;
		await page.route("**/*", (route) =>
			route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
		);
		await page.goto("https://www.amazon.co.jp/dp/B000000001");
		const report = await readKindleMetadata(page, "B000000001");
		assert.equal(report.publisher, "架空出版");
		assert.equal(report.description, "架空の紹介文");
		assert.equal(report.series?.url, "https://www.amazon.co.jp/dp/B000000099");
		assert.deepEqual(report.categories, ["Kindle本", "マンガ"]);
		assert.deepEqual(report.missingFields, []);
		await assert.rejects(readKindleMetadata(page, "B000000002"));
		const original = html;
		for (const changed of [
			original.replace("Kindle版", "単行本"),
			original.replace("ASIN ‏ : ‎ B000000001", "ASIN : B000000002"),
			original.replace("<li>出版社", "<li>ASIN : B000000001</li><li>出版社"),
		]) {
			html = changed;
			await page.reload();
			await assert.rejects(readKindleMetadata(page, "B000000001"));
		}
		html = original
			.replace('id="bookDescription_feature_div"', 'id="missing"')
			.replace('id="seriesBulletWidget_feature_div"', 'id="missing-series"');
		await page.reload();
		const missing = await readKindleMetadata(page, "B000000001");
		assert.equal(missing.description, null);
		assert.equal(missing.series, null);
		assert.deepEqual(missing.missingFields, ["description", "series"]);
		await page.goto("https://example.com/dp/B000000001");
		await assert.rejects(readKindleMetadata(page, "B000000001"));
	} finally {
		await browser.close();
	}
});
