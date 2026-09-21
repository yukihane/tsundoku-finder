import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { kindleLibraryUrl, kindleProfilePath } from "./browser.js";
import { type KindleCard, normalizeCards } from "./extract.js";

export async function readLibraryCards(page: Page): Promise<KindleCard[]> {
	const url = new URL(page.url());
	if (
		url.origin !== "https://read.amazon.co.jp" ||
		url.pathname !== "/kindle-library"
	) {
		throw new Error("Kindle library is not open");
	}
	if (await page.locator("#search-bar").inputValue()) {
		throw new Error("Clear the library search before extracting");
	}
	await page
		.locator('#cover [id^="library-item-option-"]')
		.first()
		.waitFor({ timeout: 30_000 });
	return page
		.locator('#cover [id^="library-item-option-"]')
		.evaluateAll((elements) =>
			elements.map((element) => ({
				id: element.id,
				title: element.querySelector('[id^="title-"]')?.textContent ?? "",
				authorsText:
					element.querySelector('[id^="author-"]')?.textContent ?? "",
				badges: Array.from(
					element.querySelectorAll(
						'[id^="plansBadge-"], [id^="canvasBadge-"], [id^="badge-"]',
					),
				)
					.map(
						(badge) =>
							badge.getAttribute("aria-label") ?? badge.textContent ?? "",
					)
					.filter(Boolean),
			})),
		);
}

export async function captureKindleSample(limit: number): Promise<void> {
	// Validate before starting the browser.
	normalizeCards([], limit);
	await mkdir(kindleProfilePath, { recursive: true });
	const context = await chromium.launchPersistentContext(kindleProfilePath, {
		headless: false,
		locale: "ja-JP",
		viewport: { width: 1280, height: 900 },
	});
	const closeOnSignal = (): void => {
		void context.close().catch(() => {});
	};
	process.once("SIGINT", closeOnSignal);
	process.once("SIGTERM", closeOnSignal);
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto(kindleLibraryUrl, {
			waitUntil: "domcontentloaded",
			timeout: 60_000,
		});
		console.log(
			"専用ブラウザでログインしてください。本棚の表示を最大5分待ちます。",
		);
		await page
			.locator('#cover [id^="library-item-option-"]')
			.first()
			.waitFor({ timeout: 300_000 });
		const cards = await readLibraryCards(page);
		const books = normalizeCards(cards, limit);
		if (books.length === 0) throw new Error("No non-sample books found");
		const capturedAt = new Date().toISOString();
		const report = {
			schemaVersion: 1,
			source: kindleLibraryUrl,
			capturedAt,
			scope: "loaded-dom-sample",
			complete: false,
			purchaseVerified: false,
			requestedLimit: limit,
			observedCardCount: cards.length,
			books,
		};
		const directory = fileURLToPath(
			new URL("../../.local/kindle/samples/", import.meta.url),
		);
		await mkdir(directory, { recursive: true });
		const filename = `${capturedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
		await writeFile(
			`${directory}/${filename}`,
			`${JSON.stringify(report, null, 2)}\n`,
			{ flag: "wx" },
		);
		console.log(
			`${books.length}件を .local/kindle/samples/${filename} に保存しました。`,
		);
		console.log(
			"表示済みの一部のみです。全件取得・購入済みの判定は未検証です。",
		);
	} finally {
		process.removeListener("SIGINT", closeOnSignal);
		process.removeListener("SIGTERM", closeOnSignal);
		await context.close().catch(() => {});
	}
}
