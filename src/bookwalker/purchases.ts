import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { purchasesUrl, validateLimit, validateSample } from "./import.js";

const profilePath = fileURLToPath(
	new URL("../../.local/bookwalker/browser-profile/", import.meta.url),
);

export async function readPurchaseSnapshot(
	page: Page,
	limit: number,
	fullPage = false,
) {
	if (!fullPage) validateLimit(limit);
	const snapshot = await page.evaluate((maximum) => {
		const root = document.querySelector("#pc-hold-books-react-root");
		const selects = [
			"sortDropdownBox1",
			"sortDropdownBox2",
			"sortDropdownBox3",
			"sortDropdownBox4",
			"sortDropdownBox5",
		].map((id) => {
			const el = root?.querySelector<HTMLSelectElement>(`#${id}`);
			return el?.selectedOptions[0]?.textContent?.trim();
		});
		const rows = Array.from(
			root?.querySelectorAll<HTMLElement>(".book-txt") ?? [],
		);
		const inputs = root?.querySelectorAll<HTMLInputElement>(
			'input#search-keyword[type="search"]',
		);
		const ranges =
			(root as HTMLElement | null)?.innerText.match(
				/[\d,]+\s*[〜～~]\s*[\d,]+\s*件\s*\/\s*全\s*[\d,]+\s*件/g,
			) ?? [];
		return {
			source: location.href,
			evidence: {
				heading: root?.querySelector("h2")?.textContent?.trim(),
				rangeText:
					ranges.length && new Set(ranges).size === 1 ? ranges[0] : null,
				rowCount: rows.length,
				searchText: inputs?.length === 1 ? inputs[0]?.value : null,
				ungrouped: Array.from(root?.querySelectorAll("a") ?? []).some((a) =>
					a.textContent?.includes("シリーズをまとめて表示する"),
				),
				filters: {
					category: selects[0],
					label: selects[1],
					publisher: selects[2],
					reading: selects[3],
					age: selects[4],
				},
			},
			books: rows.slice(0, maximum).map((row) => {
				const link = row.querySelector<HTMLAnchorElement>("h2 a");
				const url = link?.href ?? "";
				return {
					productId: /^https:\/\/(?:r18\.)?bookwalker\.jp\/de([^/]+)\/$/.exec(
						url,
					)?.[1],
					productUrl: url,
					title: link?.textContent?.trim(),
					authorsText:
						row.querySelector<HTMLElement>(".book-meta")?.innerText.trim() ??
						"",
					acquiredDateText: row
						.querySelector(".book-date")
						?.textContent?.trim(),
					ownership: "purchased",
				};
			}),
		};
	}, limit);
	return {
		schemaVersion: 1,
		scope: fullPage
			? "bookwalker-purchased-page"
			: "bookwalker-purchased-first-page-sample",
		store: "bookwalker-jp",
		capturedAt: new Date().toISOString(),
		complete: false,
		requestedLimit: limit,
		...snapshot,
	};
}
export async function readPurchasePage(
	page: Page,
	limit: number,
	pageNumber = 1,
	fullPage = false,
) {
	return validateSample(
		await readPurchaseSnapshot(page, limit, fullPage),
		pageNumber,
		fullPage,
	);
}

export async function capturePurchasedSample(limit = 10): Promise<void> {
	validateLimit(limit);
	await mkdir(profilePath, { recursive: true });
	const context = await chromium.launchPersistentContext(profilePath, {
		headless: false,
		locale: "ja-JP",
		viewport: { width: 1280, height: 900 },
	});
	const close = () => {
		void context.close().catch(() => {});
	};
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
	try {
		const page = await context.newPage();
		console.log(
			"BOOK☆WALKERの購入済み一覧を最大5分待ちます。必要なログイン・追加認証は専用ブラウザで行ってください。",
		);
		await page.goto(purchasesUrl, {
			waitUntil: "domcontentloaded",
			timeout: 60_000,
		});
		await page
			.locator("#pc-hold-books-react-root .book-txt")
			.first()
			.waitFor({ timeout: 300_000 });
		await page.goto(purchasesUrl, {
			waitUntil: "domcontentloaded",
			timeout: 60_000,
		});
		await page.waitForFunction(
			() => {
				const root = document.querySelector<HTMLElement>(
					"#pc-hold-books-react-root",
				);
				const m = root?.innerText.match(
					/1\s*[〜～~]\s*([\d,]+)\s*件\s*\/\s*全/,
				);
				return (
					m &&
					root?.querySelectorAll(".book-txt").length ===
						Number(m[1]?.replaceAll(",", ""))
				);
			},
			undefined,
			{ timeout: 30_000 },
		);
		const sample = await readPurchasePage(page, limit);
		const directory = fileURLToPath(
			new URL("../../.local/bookwalker/purchases/", import.meta.url),
		);
		await mkdir(directory, { recursive: true });
		const filename = `${sample.capturedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
		await writeFile(
			`${directory}/${filename}`,
			`${JSON.stringify(sample, null, 2)}\n`,
			{ flag: "wx" },
		);
		console.log(
			`${sample.books.length}件を .local/bookwalker/purchases/${filename} に保存しました。部分取得です。DBは更新していません。`,
		);
	} finally {
		process.removeListener("SIGINT", close);
		process.removeListener("SIGTERM", close);
		await context.close().catch(() => {});
	}
}
