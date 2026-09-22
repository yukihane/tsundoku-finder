import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { importOwnership, libraryPath } from "../library/database.js";
import { type OwnershipImport, validateBookId } from "../library/ownership.js";

export const purchasesUrl = "https://bookwalker.jp/holdBooks/";
const profilePath = fileURLToPath(
	new URL("../../.local/bookwalker/browser-profile/", import.meta.url),
);

export function validateLimit(limit: number): void {
	if (!Number.isInteger(limit) || limit < 1 || limit > 25)
		throw new Error("Invalid limit");
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid object");
	return value as Record<string, unknown>;
}
function text(value: unknown, empty = false): string {
	if (
		typeof value !== "string" ||
		value.length > 100000 ||
		(!empty && !value.trim())
	)
		throw new Error("Invalid text");
	return value;
}

export function validateSample(value: unknown) {
	const v = object(value);
	const limit = Number(v.requestedLimit);
	validateLimit(limit);
	const capturedAt = text(v.capturedAt);
	if (
		v.schemaVersion !== 1 ||
		v.scope !== "bookwalker-purchased-first-page-sample" ||
		v.store !== "bookwalker-jp" ||
		v.source !== purchasesUrl ||
		v.complete !== false ||
		v.requestedLimit !== limit ||
		!Number.isFinite(Date.parse(capturedAt)) ||
		new Date(capturedAt).toISOString() !== capturedAt
	)
		throw new Error("Invalid sample header");
	const e = object(v.evidence);
	const heading = text(e.heading);
	const rangeText = text(e.rangeText);
	const match =
		/^(\d[\d,]*)\s*[〜～~]\s*(\d[\d,]*)\s*件\s*\/\s*全\s*(\d[\d,]*)\s*件$/.exec(
			rangeText,
		);
	const range = match?.slice(1).map((n) => Number(n.replaceAll(",", "")));
	const total = range?.[2];
	const headingTotal = /^購入済み書籍一覧\s*\(([\d,]+)件\)$/.exec(heading)?.[1];
	if (
		range?.[0] !== 1 ||
		!total ||
		!Number.isSafeInteger(total) ||
		range[1] !== Math.min(50, total) ||
		e.rowCount !== range[1] ||
		Number(headingTotal?.replaceAll(",", "")) !== total ||
		e.ungrouped !== true
	)
		throw new Error("Invalid first-page evidence");
	const f = object(e.filters);
	const filters = {
		category: text(f.category),
		label: text(f.label),
		publisher: text(f.publisher),
		reading: text(f.reading),
		age: text(f.age),
	};
	const evidence = {
		heading,
		rangeText,
		rowCount: range[1],
		ungrouped: true,
		searchText: text(e.searchText, true),
		filters,
	};
	if (
		!Array.isArray(v.books) ||
		v.books.length !== Math.min(limit, range[1] ?? 0)
	)
		throw new Error("Invalid sample size");
	const seen = new Set<string>();
	const books = v.books.map((raw) => {
		const b = object(raw);
		const productId = text(b.productId);
		validateBookId("bookwalker-jp", productId);
		if (
			seen.has(productId) ||
			b.productUrl !== `https://bookwalker.jp/de${productId}/` ||
			b.ownership !== "purchased"
		)
			throw new Error("Invalid book identity");
		seen.add(productId);
		const acquiredDateText = text(b.acquiredDateText);
		if (!/^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}購入$/.test(acquiredDateText))
			throw new Error("Missing purchase date");
		return {
			productId,
			title: text(b.title),
			authorsText: text(b.authorsText, true),
			acquiredDateText,
			productUrl: text(b.productUrl),
			ownership: "purchased" as const,
		};
	});
	return {
		schemaVersion: 1,
		scope: "bookwalker-purchased-first-page-sample",
		store: "bookwalker-jp" as const,
		source: purchasesUrl,
		capturedAt,
		complete: false,
		requestedLimit: limit,
		evidence,
		books,
	};
}

export async function readPurchasePage(page: Page, limit: number) {
	validateLimit(limit);
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
					productId: /^https:\/\/bookwalker\.jp\/de([^/]+)\/$/.exec(url)?.[1],
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
	return validateSample({
		schemaVersion: 1,
		scope: "bookwalker-purchased-first-page-sample",
		store: "bookwalker-jp",
		capturedAt: new Date().toISOString(),
		complete: false,
		requestedLimit: limit,
		...snapshot,
	});
}

export async function importBookwalkerSample(
	filename: string,
	dbPath = libraryPath,
) {
	if ((await stat(filename)).size > 1_000_000)
		throw new Error("Sample too large");
	const sample = validateSample(JSON.parse(await readFile(filename, "utf8")));
	const input: OwnershipImport = {
		id: createHash("sha256").update(JSON.stringify(sample)).digest("hex"),
		store: "bookwalker-jp",
		startedAt: sample.capturedAt,
		completedAt: sample.capturedAt,
		coverage: { status: "partial", scope: "bookwalker-holdbooks" },
		books: sample.books.map((book) => ({
			...book,
			evidence: {
				source: sample.source,
				capturedAt: sample.capturedAt,
				pageNumber: 1,
				kind: "bookwalker-holdbooks",
				category: null,
				filter: null,
				display: sample.evidence,
			},
		})),
	};
	return importOwnership(input, dbPath);
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
