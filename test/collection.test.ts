import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { loadPurchasePage } from "../src/kindle/collect.js";
import {
	type CollectionReport,
	collectPurchasePages,
} from "../src/kindle/collection.js";

function page(number: number, total = 27) {
	const start = (number - 1) * 25 + 1;
	const end = Math.min(start + 24, total);
	return {
		source: `https://example.invalid/?page=${number}`,
		capturedAt: "2026-09-22T00:00:00Z",
		observedRange: { total, start, end },
		books: Array.from({ length: end - start + 1 }, (_, index) => ({
			asin: String(start + index),
		})),
	};
}

test("collection completes only with contiguous unique pages and persists partial progress", async () => {
	for (const scenario of [
		"complete",
		"limit",
		"duplicate",
		"changed-total",
		"load-failed",
		"save-failed",
		"interrupted",
	]) {
		const controller = new AbortController();
		const saved: number[] = [];
		const reports: CollectionReport[] = [];
		const report = await collectPurchasePages({
			maxPages: scenario === "limit" ? 1 : 10,
			signal: controller.signal,
			load: async (number) => {
				if (number === 2 && scenario === "load-failed")
					throw new Error("private URL must not escape");
				const result = page(
					number,
					scenario === "changed-total" && number === 2 ? 28 : 27,
				);
				if (number === 2 && scenario === "duplicate")
					result.books[0] = { asin: "1" };
				return result;
			},
			savePage: async (number) => {
				if (number === 2 && scenario === "save-failed")
					throw new Error("disk failure");
				saved.push(number);
				return `page-${number}.json`;
			},
			saveReport: async (report) => {
				reports.push(structuredClone(report));
			},
			pause: async () => {
				if (scenario === "interrupted") controller.abort();
			},
		});
		assert.equal(reports[0]?.complete, false);
		assert.equal(report.complete, scenario === "complete");
		assert.equal(report.collectedCount, scenario === "complete" ? 27 : 25);
		assert.deepEqual(saved, scenario === "complete" ? [1, 2] : [1]);
		assert.equal(
			report.status,
			scenario === "complete"
				? "completed"
				: scenario === "limit"
					? "page-limit"
					: scenario === "interrupted"
						? "interrupted"
						: "failed",
		);
		assert.ok(!JSON.stringify(report).includes("private URL"));
	}
});

test("page loader navigates to a fresh second page and checks displayed range", async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.route("**/*", (route) =>
			route.fulfill({
				contentType: "text/html; charset=utf-8",
				body: `
      <div id="ContentCategoryDropDown"><div class="drop-down-text">本</div></div>
      <div id="ContentSubCategoryDropDown"><div class="drop-down-text">購入済み</div></div>
      <input id="content-search-box" value="">
      <div id="CONTENT_COUNT">27のうち26から27までの商品を表示しています</div>
      <div id="pagination"><a class="active" id="page-2">2</a></div>
      ${[26, 27].map((n) => `<div id="content-title-B0000000${n}">架空の本${n}</div><div id="content-acquired-date-B0000000${n}">取得日: 2026年9月1日</div>`).join("")}`,
			}),
		);
		const result = await loadPurchasePage(page, 2);
		assert.equal(result.books.length, 2);
		assert.deepEqual(result.observedRange, { total: 27, start: 26, end: 27 });
		assert.match(result.ownershipEvidence.source, /pageNumber=2$/);
	} finally {
		await browser.close();
	}
});
