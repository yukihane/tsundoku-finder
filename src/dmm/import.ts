import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { OwnershipImport } from "../library/ownership.js";
import {
	isProductId,
	productIdentity,
	shelfUrl,
	volumeUrl,
} from "./identity.js";

function object(v: unknown): Record<string, unknown> {
	if (!v || typeof v !== "object" || Array.isArray(v))
		throw new Error("Invalid DMM object");
	return v as Record<string, unknown>;
}
function text(v: unknown, empty = false): string {
	if (typeof v !== "string" || v.length > 100000 || (!empty && !v.trim()))
		throw new Error("Invalid DMM text");
	return v;
}
function list(v: unknown): unknown[] {
	if (!Array.isArray(v) || v.length > 100) throw new Error("Invalid DMM list");
	return v;
}
function timestamp(v: unknown) {
	const s = text(v);
	if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s)
		throw new Error("Invalid timestamp");
	return s;
}
export function validateLimit(n: number) {
	if (!Number.isSafeInteger(n) || n < 1 || n > 25)
		throw new Error("Invalid DMM sample limit");
}
export function range(v: unknown, count: unknown, expectedStart = 1) {
	const ranges = list(v).map((s) => text(s));
	if (!ranges.length || new Set(ranges).size !== 1)
		throw new Error("Ambiguous DMM range");
	const match =
		/^(\d[\d,]*)\s*[〜～~]\s*(\d[\d,]*)\s*件\s*\/\s*全\s*(\d[\d,]*)\s*件$/.exec(
			ranges[0] ?? "",
		);
	const [start, end, total] =
		match?.slice(1).map((s) => Number(s.replaceAll(",", ""))) ?? [];
	if (
		!Number.isSafeInteger(expectedStart) ||
		expectedStart < 1 ||
		start !== expectedStart ||
		!end ||
		!total ||
		!Number.isSafeInteger(total) ||
		end > total ||
		end < start ||
		end - start + 1 !== count ||
		end - start + 1 > 100
	)
		throw new Error("Invalid DMM first-page range");
	return { ranges, rowCount: end - start + 1, total, start, end };
}
export function validateShelf(raw: unknown, pageNumber = 1) {
	const v = object(raw);
	const r = range(v.ranges, v.rowCount, (pageNumber - 1) * 20 + 1);
	if (
		v.source !==
			(pageNumber === 1 ? shelfUrl : `${shelfUrl}?page=${pageNumber}`) ||
		v.heading !== "本棚" ||
		v.search !== "" ||
		v.sort !== "購入日が新しい順" ||
		JSON.stringify(v.filters) !==
			JSON.stringify(["全年齢 / R18すべて", "購入済みすべて"]) ||
		JSON.stringify(v.selectedFilters) !== JSON.stringify(v.filters) ||
		v.expiryFilter !== "orangeBoldSquareOn" ||
		r.rowCount !== Math.min(20, r.total - r.start + 1)
	)
		throw new Error("Unsupported DMM shelf conditions");
	const seen = new Set<string>();
	const series = list(v.series).map((value) => {
		const s = object(value);
		const url = text(s.url);
		const id =
			/^https:\/\/book\.dmm\.com\/product\/([1-9]\d*)\/volumes\/\?tab=purchased$/.exec(
				url,
			)?.[1];
		if (!id || seen.has(id)) throw new Error("Invalid DMM shelf series");
		seen.add(id);
		return { url, authorsText: text(s.authorsText, true) };
	});
	if (series.length !== r.rowCount) throw new Error("DMM shelf count mismatch");
	return {
		source: text(v.source),
		heading: "本棚",
		ranges: r.ranges,
		rowCount: r.rowCount,
		filters: ["全年齢 / R18すべて", "購入済みすべて"],
		selectedFilters: ["全年齢 / R18すべて", "購入済みすべて"],
		expiryFilter: text(v.expiryFilter),
		search: "",
		sort: "購入日が新しい順",
		series,
	};
}
export function validateVolumes(raw: unknown, expectedStart = 1) {
	const v = object(raw);
	const source = text(v.source);
	const seriesId =
		/^https:\/\/book\.dmm\.com\/product\/([1-9]\d*)\/volumes\/\?tab=purchased(?:&page=[1-9]\d*)?$/.exec(
			source,
		)?.[1];
	if (
		!seriesId ||
		JSON.stringify(v.selectedTabs) !== '["購入済み"]' ||
		v.otherRowCount !== 0
	)
		throw new Error("Not a DMM purchased volume page");
	const r = range(v.ranges, v.rowCount, expectedStart);
	const seen = new Set<string>();
	const books = list(v.books).map((rawBook) => {
		const b = object(rawBook);
		const downloadUrl = text(b.downloadUrl);
		const d = new URL(downloadUrl);
		const productId = d.searchParams.get("product_id") ?? "";
		if (
			d.origin !== "https://book.dmm.com" ||
			d.pathname !== "/download/" ||
			d.username ||
			d.password ||
			d.hash ||
			!isProductId(productId) ||
			d.searchParams.getAll("product_id").length !== 1 ||
			seen.has(productId) ||
			!list(b.labels).includes("購入済み")
		)
			throw new Error("Invalid DMM owned product");
		const productUrl = `https://book.dmm.com/product/${seriesId}/${productId}/`;
		if (
			b.productLink !== productUrl &&
			b.productLink !== `https://book.dmm.com/product/${seriesId}/latest/`
		)
			throw new Error("DMM product link mismatch");
		const reviewUrl = b.reviewUrl === null ? null : text(b.reviewUrl);
		if (reviewUrl) {
			const review = new URL(reviewUrl);
			if (
				review.origin !== "https://review.dmm.com" ||
				review.pathname !== "/review-front/review/posting" ||
				review.searchParams.get("content_id") !== productId ||
				review.searchParams.getAll("content_id").length !== 1
			)
				throw new Error("DMM review ID mismatch");
		}
		seen.add(productId);
		return {
			title: text(b.title),
			productLink: text(b.productLink),
			labels: list(b.labels).map((s) => text(s)),
			downloadUrl,
			reviewUrl,
		};
	});
	if (books.length !== r.rowCount) throw new Error("DMM volume count mismatch");
	return {
		source,
		heading: text(v.heading),
		selectedTabs: ["購入済み"],
		ranges: r.ranges,
		rowCount: r.rowCount,
		otherRowCount: 0,
		books,
	};
}

export function validateSample(raw: unknown) {
	const v = object(raw);
	const limit = v.requestedLimit;
	if (typeof limit !== "number") throw new Error("Invalid limit");
	validateLimit(limit);
	if (
		v.schemaVersion !== 1 ||
		v.scope !== "dmm-purchased-sample" ||
		v.store !== "dmm-books" ||
		v.complete !== false
	)
		throw new Error("Invalid DMM sample header");
	const startedAt = timestamp(v.startedAt);
	const completedAt = timestamp(v.completedAt);
	if (startedAt > completedAt) throw new Error("Invalid DMM capture interval");
	const shelf = validateShelf(v.shelf);
	const pages = list(v.pages).map((rawPage) => {
		const p = object(rawPage);
		const capturedAt = timestamp(p.capturedAt);
		if (capturedAt < startedAt || capturedAt > completedAt)
			throw new Error("Invalid DMM page timestamp");
		return { capturedAt, ...validateVolumes(p) };
	});
	if (!pages.length || pages.length > shelf.series.length)
		throw new Error("Invalid DMM page count");
	const seen = new Set<string>();
	let available = 0;
	for (const [index, page] of pages.entries()) {
		if (page.source !== shelf.series[index]?.url || available >= limit)
			throw new Error("Non-contiguous or excessive DMM sample");
		for (const b of page.books) {
			const id = new URL(b.downloadUrl).searchParams.get("product_id") ?? "";
			if (seen.has(id)) throw new Error("Duplicate DMM product");
			seen.add(id);
		}
		available += page.books.length;
	}
	if (available < limit && pages.length !== shelf.series.length)
		throw new Error("Incomplete DMM sample");
	return {
		schemaVersion: 1,
		scope: "dmm-purchased-sample",
		store: "dmm-books",
		complete: false,
		requestedLimit: limit,
		startedAt,
		completedAt,
		shelf,
		pages,
	};
}

export function toOwnership(raw: unknown): OwnershipImport {
	const sample = validateSample(raw);
	return {
		id: createHash("sha256").update(JSON.stringify(sample)).digest("hex"),
		store: "dmm-books",
		startedAt: sample.startedAt,
		completedAt: sample.completedAt,
		coverage: { status: "partial", scope: "dmm-shelf-purchased-volumes" },
		books: sample.pages
			.flatMap((page, index) =>
				page.books.map((b) => {
					const productId =
						new URL(b.downloadUrl).searchParams.get("product_id") ?? "";
					const seriesId = /\/product\/(\d+)\//.exec(page.source)?.[1] ?? "";
					return {
						productId,
						title: b.title,
						authorsText: sample.shelf.series[index]?.authorsText ?? "",
						acquiredDateText: null,
						productUrl: `https://book.dmm.com/product/${seriesId}/${productId}/`,
						evidence: {
							source: page.source,
							capturedAt: page.capturedAt,
							pageNumber: 1,
							kind: "dmm-purchased-volume",
							category: null,
							filter: "購入済み",
							display: {
								shelfSource: shelfUrl,
								shelfPage: 1,
								seriesPosition: index + 1,
								shelfRanges: sample.shelf.ranges,
								expiryFilter: sample.shelf.expiryFilter,
								filters: sample.shelf.filters,
								volumeRanges: page.ranges,
								selectedTab: "購入済み",
								ownershipLabel: "購入済み",
								productLink: b.productLink,
								contentId: productId,
								acquiredDateSource: null,
							},
						},
					};
				}),
			)
			.slice(0, sample.requestedLimit),
	};
}
export function validateDmmOwnership(input: OwnershipImport) {
	if (input.coverage.scope !== "dmm-shelf-purchased-volumes")
		throw new Error("Invalid DMM coverage");
	for (const b of input.books) {
		const { seriesId } = productIdentity(b.productUrl);
		const e = b.evidence;
		const d = e.display;
		if (
			e.source !==
				(e.pageNumber === 1
					? volumeUrl(seriesId)
					: `${volumeUrl(seriesId)}&page=${e.pageNumber}`) ||
			e.kind !== "dmm-purchased-volume" ||
			e.category !== null ||
			e.filter !== "購入済み" ||
			b.acquiredDateText !== null ||
			!d ||
			d.shelfSource !== shelfUrl ||
			d.selectedTab !== "購入済み" ||
			d.ownershipLabel !== "購入済み" ||
			d.contentId !== b.productId ||
			(d.productLink !== b.productUrl &&
				d.productLink !== `https://book.dmm.com/product/${seriesId}/latest/`)
		)
			throw new Error("Invalid DMM ownership evidence");
	}
}
export async function importDmmSample(filename: string, dbPath?: string) {
	if ((await stat(filename)).size > 1_000_000)
		throw new Error("DMM sample too large");
	const input = toOwnership(JSON.parse(await readFile(filename, "utf8")));
	const { importOwnership } = await import("../library/database.js");
	return importOwnership(input, dbPath);
}
