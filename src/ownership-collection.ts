import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
	purchasesUrl,
	validateSample as validateBw,
} from "./bookwalker/import.js";
import { readPurchasePage } from "./bookwalker/purchases.js";
import { readShelfDom, readVolumesDom } from "./dmm/dom.js";
import { shelfUrl } from "./dmm/identity.js";
import { range, validateShelf, validateVolumes } from "./dmm/import.js";
import { restoreDmmSession, saveDmmSession } from "./dmm/session.js";
import { importOwnership } from "./library/database.js";
import type { OwnershipImport } from "./library/ownership.js";
import { lockFile, writeJson } from "./local-files.js";

type Shelf = ReturnType<typeof validateShelf>;
type Volume = ReturnType<typeof validateVolumes> & { capturedAt: string };
type BwPage = ReturnType<typeof validateBw>;
export type Collection = {
	schemaVersion: 1;
	command: "bookwalker" | "dmm";
	startedAt: string;
	updatedAt: string;
	complete: boolean;
	pages: BwPage[];
	shelves: Shelf[];
	volumes: Volume[][];
};
function timestamp(s: string, state: Collection) {
	if (
		!Number.isFinite(Date.parse(s)) ||
		new Date(s).toISOString() !== s ||
		s < state.startedAt ||
		s > state.updatedAt
	)
		throw new Error("Invalid capture time");
}
function bwTotal(p: BwPage) {
	return Number(
		p.evidence.heading.match(/\(([\d,]+)件\)/)?.[1]?.replaceAll(",", ""),
	);
}
function bwConditions(p: BwPage) {
	if (
		p.evidence.searchText !== "" ||
		JSON.stringify(Object.values(p.evidence.filters)) !==
			JSON.stringify(["カテゴリ", "レーベル", "出版社", "読書状態", "R18表示"])
	)
		throw new Error("Filtered BOOKWALKER list");
}
export function collectionOwnership(
	state: Collection,
	requireComplete = true,
): OwnershipImport {
	if (
		state.schemaVersion !== 1 ||
		!["bookwalker", "dmm"].includes(state.command) ||
		typeof state.complete !== "boolean" ||
		!Array.isArray(state.pages) ||
		!Array.isArray(state.shelves) ||
		!Array.isArray(state.volumes)
	)
		throw new Error("Invalid collection");
	timestamp(state.startedAt, state);
	timestamp(state.updatedAt, state);
	const books: OwnershipImport["books"] = [];
	let finished = false;
	if (state.command === "bookwalker") {
		if (state.shelves.length || state.volumes.length)
			throw new Error("Unexpected DMM pages");
		let total = 0;
		for (const [i, raw] of state.pages.entries()) {
			const p = validateBw(raw, i + 1, true);
			bwConditions(p);
			timestamp(p.capturedAt, state);
			if (i && bwTotal(p) !== total)
				throw new Error("BOOKWALKER total changed");
			total = bwTotal(p);
			books.push(
				...p.books.map((b) => ({
					...b,
					evidence: {
						source: p.source,
						capturedAt: p.capturedAt,
						pageNumber: i + 1,
						kind: "bookwalker-holdbooks",
						category: null,
						filter: null,
						display: p.evidence,
					},
				})),
			);
		}
		finished = total > 0 && books.length === total;
	} else {
		if (state.pages.length) throw new Error("Unexpected BOOKWALKER pages");
		const series: {
			shelf: Shelf;
			url: string;
			authorsText: string;
			position: number;
			page: number;
		}[] = [];
		let total = 0;
		for (const [i, raw] of state.shelves.entries()) {
			const s = validateShelf(raw, i + 1);
			const r = range(s.ranges, s.rowCount, i * 20 + 1);
			if (i && total !== r.total) throw new Error("DMM shelf total changed");
			total = r.total;
			series.push(
				...s.series.map((entry, j) => ({
					...entry,
					shelf: s,
					position: i * 20 + j + 1,
					page: i + 1,
				})),
			);
		}
		if (
			new Set(series.map((s) => s.url)).size !== series.length ||
			state.volumes.length > series.length
		)
			throw new Error("Invalid DMM series coverage");
		let completedSeries = 0;
		for (const [i, group] of state.volumes.entries()) {
			const s = series[i];
			if (!s || !Array.isArray(group) || !group.length)
				throw new Error("Missing series");
			let end = 0;
			let volumeTotal = 0;
			for (const [j, raw] of group.entries()) {
				const p = validateVolumes(raw, end + 1);
				timestamp(raw.capturedAt, state);
				const r = range(p.ranges, p.rowCount, end + 1);
				if (
					p.source !== (j === 0 ? s.url : `${s.url}&page=${j + 1}`) ||
					(j && r.total !== volumeTotal)
				)
					throw new Error("DMM volume coverage changed");
				end = r.end;
				volumeTotal = r.total;
				books.push(
					...p.books.map((b) => {
						const productId =
							new URL(b.downloadUrl).searchParams.get("product_id") ?? "";
						const productUrl = `${s.url.split("volumes/")[0]}${productId}/`;
						return {
							productId,
							productUrl,
							title: b.title,
							authorsText: s.authorsText,
							acquiredDateText: null,
							evidence: {
								source: p.source,
								capturedAt: raw.capturedAt,
								pageNumber: j + 1,
								kind: "dmm-purchased-volume",
								category: null,
								filter: "購入済み",
								display: {
									shelfSource: shelfUrl,
									shelfPage: s.page,
									seriesPosition: s.position,
									shelfRanges: s.shelf.ranges,
									expiryFilter: s.shelf.expiryFilter,
									filters: s.shelf.filters,
									volumeRanges: p.ranges,
									selectedTab: "購入済み",
									ownershipLabel: "購入済み",
									productLink: b.productLink,
									contentId: productId,
									acquiredDateSource: null,
								},
							},
						};
					}),
				);
			}
			if (end === volumeTotal) completedSeries++;
			else if (i !== state.volumes.length - 1)
				throw new Error("Skipped volume pages");
		}
		finished =
			total > 0 && series.length === total && completedSeries === total;
	}
	if (
		books.length > 25000 ||
		new Set(books.map((b) => b.productId)).size !== books.length
	)
		throw new Error("Duplicate products or excessive collection");
	if ((state.complete || requireComplete) && !finished)
		throw new Error("Incomplete collection");
	if (requireComplete && !state.complete)
		throw new Error("Collection was interrupted");
	return {
		id: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
		store: state.command === "dmm" ? "dmm-books" : "bookwalker-jp",
		startedAt: state.startedAt,
		completedAt: state.updatedAt,
		coverage: {
			status: "complete",
			scope:
				state.command === "dmm"
					? "dmm-shelf-purchased-volumes"
					: "bookwalker-holdbooks",
		},
		books,
	};
}

async function load(filename: string) {
	if ((await stat(filename)).size > 50_000_000)
		throw new Error("Collection too large");
	const state = JSON.parse(await readFile(filename, "utf8")) as Collection;
	collectionOwnership(state, false);
	return state;
}
export async function importCollection(filename: string, dbPath?: string) {
	return importOwnership(collectionOwnership(await load(filename)), dbPath);
}
async function go(page: Page, url: string, selector: string, first = false) {
	await delay(2000);
	const response = await page.goto(url, {
		waitUntil: "domcontentloaded",
		timeout: 60000,
	});
	if (!response?.ok()) throw new Error("Ownership request failed");
	await page
		.locator(selector)
		.first()
		.waitFor({ timeout: first ? 300000 : 30000 });
}
export async function captureCollection(
	command: "bookwalker" | "dmm",
	resume?: string,
	maxPages = 1000,
) {
	if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000)
		throw new Error("Invalid page limit");
	const root = fileURLToPath(new URL(`../.local/${command}/`, import.meta.url));
	const filename = resume
		? resolve(resume)
		: resolve(root, "collections", `${randomUUID()}.json`);
	const unlock = await lockFile(resolve(root, "collection.lock"));
	try {
		const now = new Date().toISOString();
		const state: Collection = resume
			? await load(filename)
			: {
					schemaVersion: 1,
					command,
					startedAt: now,
					updatedAt: now,
					complete: false,
					pages: [],
					shelves: [],
					volumes: [],
				};
		if (state.command !== command) throw new Error("Wrong collection store");
		if (state.complete) return filename;
		const save = async () => {
			state.updatedAt = new Date().toISOString();
			collectionOwnership(state, false);
			await writeJson(filename, state);
		};
		await save();
		console.log(`取得記録: ${filename}`);
		const context = await chromium.launchPersistentContext(
			resolve(root, "browser-profile"),
			{
				headless: false,
				locale: "ja-JP",
				viewport: { width: 1280, height: 900 },
			},
		);
		const close = () => {
			void context.close().catch(() => {});
		};
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
		let fetched = 0;
		try {
			if (command === "dmm") await restoreDmmSession(context, root);
			const page = await context.newPage();
			if (command === "bookwalker") {
				await go(
					page,
					purchasesUrl,
					"#pc-hold-books-react-root .book-txt",
					true,
				);
				await page.waitForTimeout(1500);
				const first = await readPurchasePage(page, 50, 1, true);
				bwConditions(first);
				if (
					state.pages.length &&
					bwTotal(first) !== bwTotal(state.pages[0] as BwPage)
				)
					throw new Error("Total changed since interruption");
				if (!state.pages.length) {
					state.pages.push(first);
					fetched++;
					await save();
				}
				while (state.pages.length * 50 < bwTotal(first)) {
					if (fetched >= maxPages) return filename;
					const n = state.pages.length + 1;
					await go(
						page,
						`${purchasesUrl}?page=${n}`,
						"#pc-hold-books-react-root .book-txt",
					);
					await page.waitForTimeout(1000);
					state.pages.push(await readPurchasePage(page, 50, n, true));
					fetched++;
					await save();
					console.log(`BOOK☆WALKER: ${state.pages.length}ページ保存`);
				}
			} else {
				await go(page, shelfUrl, '[data-e2e="library"] > li', true);
				const first = validateShelf(await page.evaluate(readShelfDom));
				await saveDmmSession(context, root);
				const total = range(first.ranges, first.rowCount).total;
				if (
					state.shelves.length &&
					total !==
						range(state.shelves[0]?.ranges, state.shelves[0]?.rowCount).total
				)
					throw new Error("Total changed since interruption");
				if (!state.shelves.length) {
					state.shelves.push(first);
					fetched++;
					await save();
				}
				while (state.shelves.length * 20 < total) {
					if (fetched >= maxPages) return filename;
					const n = state.shelves.length + 1;
					await go(page, `${shelfUrl}?page=${n}`, '[data-e2e="library"] > li');
					state.shelves.push(
						validateShelf(await page.evaluate(readShelfDom), n),
					);
					fetched++;
					await save();
				}
				const series = state.shelves.flatMap((s) => s.series);
				for (const [i, s] of series.entries()) {
					const group = state.volumes[i] ?? [];
					let end = group.reduce((n, p) => n + p.rowCount, 0);
					let totalVolumes = group[0]
						? range(group[0].ranges, group[0].rowCount).total
						: Infinity;
					while (end < totalVolumes) {
						if (fetched >= maxPages) return filename;
						const previous = group.at(-1);
						const source = previous?.source ?? s.url;
						if (page.url() !== source)
							await go(page, source, '[data-testid="purchased-volume-book"]');
						if (group.length) {
							await delay(2000);
							// Follow the observed page control; reject unknown URL conventions below.
							await page
								.locator("main a")
								.filter({ hasText: new RegExp(`^${group.length + 1}$`) })
								.first()
								.click();
							await page.waitForFunction(
								(start) =>
									Array.from(document.querySelectorAll("main p")).some((p) =>
										p.textContent?.startsWith(`${start}〜`),
									),
								end + 1,
								{ timeout: 30000 },
							);
						}
						const p = {
							...validateVolumes(await page.evaluate(readVolumesDom), end + 1),
							capturedAt: new Date().toISOString(),
						};
						const r = range(p.ranges, p.rowCount, end + 1);
						end = r.end;
						totalVolumes = r.total;
						group.push(p);
						state.volumes[i] = group;
						fetched++;
						await save();
					}
					console.log(`DMM: ${i + 1}/${series.length}シリーズ保存`);
				}
			}
			state.complete = true;
			await save();
			console.log("対象範囲の全件取得を完了しました。DBは更新していません。");
			return filename;
		} catch (error) {
			await writeJson(`${filename}.error.json`, {
				at: new Date().toISOString(),
				message:
					error instanceof Error ? error.message : "Unknown collection failure",
			});
			throw error;
		} finally {
			process.removeListener("SIGINT", close);
			process.removeListener("SIGTERM", close);
			await context.close().catch(() => {});
		}
	} finally {
		await unlock();
	}
}
