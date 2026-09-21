import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { purchasesUrl } from "./source.js";

export interface ImportedBook {
	asin: string;
	title: string;
	authorsText: string;
	acquiredDateText: string;
	productUrl: string;
	capturedAt: string;
	source: string;
	pageNumber: number;
}
export interface KindleImport {
	id: string;
	startedAt: string;
	completedAt: string;
	books: ImportedBook[];
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid object");
	return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error("Invalid array");
	return value;
}
function text(value: unknown, allowEmpty = false): string {
	if (typeof value !== "string" || (!allowEmpty && !value.trim()))
		throw new Error("Invalid text");
	return value;
}
function timestamp(value: unknown): string {
	const result = text(value);
	if (
		!Number.isFinite(Date.parse(result)) ||
		new Date(result).toISOString() !== result
	)
		throw new Error("Invalid timestamp");
	return result;
}
function requireValue(condition: boolean): void {
	if (!condition) throw new Error("Inconsistent collection");
}
async function jsonFile(path: string) {
	if ((await stat(path)).size > 10_000_000) throw new Error("File too large");
	const raw = await readFile(path);
	return { raw, value: object(JSON.parse(raw.toString("utf8"))) };
}

// Treat files as untrusted input: validate the complete collection before any DB
// is opened. Never trust complete:true without checking every referenced page.
export async function readKindleImport(
	directory: string,
): Promise<KindleImport> {
	const root = await realpath(resolve(directory));
	const manifestPath = await realpath(join(root, "report.json"));
	requireValue(relative(root, dirname(manifestPath)) === "");
	const manifest = await jsonFile(manifestPath);
	const report = manifest.value;
	requireValue(
		report.schemaVersion === 1 &&
			report.scope === "purchased-library" &&
			report.complete === true &&
			report.status === "completed" &&
			report.failure === null,
	);
	const total = report.expectedTotal;
	requireValue(
		typeof total === "number" &&
			Number.isSafeInteger(total) &&
			total > 0 &&
			total <= 25000 &&
			report.collectedCount === total,
	);
	const startedAt = timestamp(report.startedAt);
	const completedAt = timestamp(report.updatedAt);
	requireValue(startedAt <= completedAt);
	const entries = array(report.pages);
	requireValue(entries.length === Math.ceil(Number(total) / 25));
	const hash = createHash("sha256").update(manifest.raw);
	const books: ImportedBook[] = [];
	const seen = new Set<string>();
	for (const [index, value] of entries.entries()) {
		const entry = object(value);
		const pageNumber = index + 1;
		const file = `page-${String(pageNumber).padStart(4, "0")}.json`;
		requireValue(entry.pageNumber === pageNumber && entry.file === file);
		const path = await realpath(join(root, file));
		requireValue(relative(root, dirname(path)) === "");
		const loaded = await jsonFile(path);
		hash.update(loaded.raw);
		const page = loaded.value;
		const source =
			index === 0 ? purchasesUrl : `${purchasesUrl}?pageNumber=${pageNumber}`;
		const capturedAt = timestamp(page.capturedAt);
		requireValue(capturedAt >= startedAt && capturedAt <= completedAt);
		const range = object(page.observedRange);
		const start = index * 25 + 1;
		const end = Math.min(start + 24, Number(total));
		requireValue(
			page.schemaVersion === 1 &&
				page.scope === "purchased-page" &&
				page.complete === false &&
				page.requestedLimit === 25 &&
				page.source === source &&
				entry.source === source &&
				entry.capturedAt === capturedAt &&
				entry.start === start &&
				entry.end === end &&
				range.start === start &&
				range.end === end &&
				range.total === total,
		);
		const evidence = object(page.ownershipEvidence);
		requireValue(
			evidence.kind === "amazon-content-filter" &&
				evidence.category === "本" &&
				evidence.filter === "購入済み" &&
				evidence.source === source &&
				evidence.capturedAt === capturedAt,
		);
		const rows = array(page.books);
		requireValue(rows.length === end - start + 1);
		for (const value of rows) {
			const book = object(value);
			const asin = text(book.asin);
			const productUrl = `https://www.amazon.co.jp/dp/${asin}`;
			requireValue(
				/^[A-Z0-9]{10}$/.test(asin) &&
					!seen.has(asin) &&
					book.ownership === "purchased" &&
					book.productUrlSource === "derived-from-asin" &&
					book.productUrl === productUrl,
			);
			seen.add(asin);
			books.push({
				asin,
				title: text(book.title),
				authorsText: text(book.authorsText, true),
				acquiredDateText: text(book.acquiredDateText),
				productUrl,
				capturedAt,
				source,
				pageNumber,
			});
		}
	}
	requireValue(books.length === total);
	return { id: hash.digest("hex"), startedAt, completedAt, books };
}
