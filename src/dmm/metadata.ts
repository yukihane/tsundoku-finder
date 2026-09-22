import type { Page } from "playwright";
import { validateMetadata } from "../metadata/import.js";
import { readMetadataDom } from "./dom.js";
import { canonicalProductUrl, productIdentity } from "./identity.js";

export function metadataFromSnapshot(
	snapshot: ReturnType<typeof readMetadataDom>,
	productId: string,
	capturedAt = new Date().toISOString(),
) {
	const source = canonicalProductUrl(productId, snapshot.canonical);
	const url = new URL(snapshot.url);
	if (
		url.origin + url.pathname !== source ||
		!snapshot.title ||
		snapshot.detailCount !== 1 ||
		!snapshot.fields.length
	)
		throw new Error("DMM product identity mismatch");
	const field = (name: string) => {
		const matches = snapshot.fields.filter((f) => f.name === name);
		if (matches.length > 1) throw new Error("Ambiguous DMM metadata field");
		return matches[0];
	};
	const publisher = field("出版社")?.text ?? null;
	const categories =
		field("カテゴリー")
			?.links.map((a) => a.text)
			.filter(Boolean) ?? [];
	const seriesField = field("シリーズ名");
	let series = null;
	if (seriesField?.links.length === 1) {
		const link = seriesField.links[0];
		if (link?.text) {
			const seriesUrl = new URL(link.url);
			const canonical = seriesUrl.origin + seriesUrl.pathname;
			if (
				productIdentity(canonical).seriesId !== productIdentity(source).seriesId
			)
				throw new Error("DMM series mismatch");
			series = { text: link.text, url: canonical };
		}
	}
	return validateMetadata({
		schemaVersion: 1,
		scope: "dmm-metadata-sample",
		store: "dmm-books",
		productId,
		source,
		capturedAt,
		title: snapshot.title,
		authorsText: field("作家")?.text,
		publisher,
		description: snapshot.description,
		publicationDateText: null,
		distributionDateText: field("配信開始日")?.text ?? null,
		label: field("掲載誌・レーベル")?.text ?? null,
		categories,
		genres:
			field("ジャンル")
				?.links.map((a) => a.text)
				.filter(Boolean) ?? [],
		series,
		missingFields: [
			!publisher && "publisher",
			!snapshot.description && "description",
			!categories.length && "categories",
			!series && "series",
		].filter(Boolean),
	});
}
export async function readDmmMetadata(page: Page, productId: string) {
	return metadataFromSnapshot(await page.evaluate(readMetadataDom), productId);
}
