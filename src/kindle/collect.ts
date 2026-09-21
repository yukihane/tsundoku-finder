import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { kindleProfilePath } from "./browser.js";
import { collectPurchasePages, validateMaxPages } from "./collection.js";
import { purchasesUrl, readPurchasePage } from "./purchases.js";

export async function loadPurchasePage(page: Page, pageNumber: number) {
	const url =
		pageNumber === 1
			? purchasesUrl
			: `${purchasesUrl}?pageNumber=${pageNumber}`;
	const response = await page.goto(url, {
		waitUntil: "domcontentloaded",
		timeout: 60_000,
	});
	if (!response?.ok()) throw new Error("Page request failed");
	await page.waitForFunction(
		(expectedPage) => {
			const count = document.querySelector("#CONTENT_COUNT")?.textContent ?? "";
			const match =
				/([\d,]+)のうち([\d,]+)から([\d,]+)までの商品を表示しています/.exec(
					count,
				);
			if (!match) return false;
			const start = Number(match[2]?.replaceAll(",", ""));
			const end = Number(match[3]?.replaceAll(",", ""));
			const active = document.querySelector("#pagination .active");
			return (
				start === (expectedPage - 1) * 25 + 1 &&
				(!active ? expectedPage === 1 : active.id === `page-${expectedPage}`) &&
				document.querySelectorAll('[id^="content-title-"]').length ===
					end - start + 1
			);
		},
		pageNumber,
		{ timeout: 30_000 },
	);
	return readPurchasePage(page, 25, pageNumber);
}

export async function captureAllPurchases(maxPages = 1000): Promise<boolean> {
	validateMaxPages(maxPages);
	const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
	const directory = fileURLToPath(
		new URL(`../../.local/kindle/collections/${runId}/`, import.meta.url),
	);
	await mkdir(directory, { recursive: true });
	await mkdir(kindleProfilePath, { recursive: true });
	const context = await chromium.launchPersistentContext(kindleProfilePath, {
		headless: false,
		locale: "ja-JP",
		viewport: { width: 1280, height: 900 },
	});
	const controller = new AbortController();
	const stop = (): void => {
		controller.abort();
		void context.close().catch(() => {});
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	context.once("close", () => controller.abort());
	try {
		const page = await context.newPage();
		console.log(`保存先: .local/kindle/collections/${runId}/`);
		const report = await collectPurchasePages({
			maxPages,
			signal: controller.signal,
			load: async (pageNumber) => {
				if (pageNumber === 1) {
					const response = await page.goto(purchasesUrl, {
						waitUntil: "domcontentloaded",
						timeout: 60_000,
					});
					if (!response?.ok()) throw new Error("Page request failed");
					console.log(
						"購入済み画面を最大5分待ちます。必要ならログインしてください。",
					);
					await page
						.locator("#CONTENT_ACTION_BAR")
						.waitFor({ timeout: 300_000 });
				}
				return loadPurchasePage(page, pageNumber);
			},
			savePage: async (pageNumber, result) => {
				const file = `page-${String(pageNumber).padStart(4, "0")}.json`;
				await writeFile(
					join(directory, file),
					`${JSON.stringify({ ...result, scope: "purchased-page" }, null, 2)}\n`,
					{ flag: "wx" },
				);
				return file;
			},
			saveReport: async (report) => {
				const temporary = join(directory, "report.json.tmp");
				await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
				await rename(temporary, join(directory, "report.json"));
			},
			pause: () => setTimeout(3000, undefined, { signal: controller.signal }),
			progress: (report) =>
				console.log(
					`${report.pages.length}ページ保存 / ${report.collectedCount}件 / ${report.status}`,
				),
		});
		if (!report.complete)
			console.error(
				`取得未完了 (${report.status})。保存済みページは保持しています。再実行は先頭から別フォルダーに保存します。`,
			);
		return report.complete;
	} finally {
		process.removeListener("SIGINT", stop);
		process.removeListener("SIGTERM", stop);
		await context.close().catch(() => {});
	}
}
