import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { importOwnership, libraryPath } from "../library/database.js";
import { type OwnershipImport, validateBookId } from "../library/ownership.js";
export const purchasesUrl = "https://bookwalker.jp/holdBooks/";
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
