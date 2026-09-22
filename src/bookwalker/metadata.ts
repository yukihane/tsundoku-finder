import type { Page } from "playwright";
import { validateMetadata } from "../metadata/import.js";
import { bookwalkerAdapter } from "./adapter.js";

export async function readBookwalkerMetadata(page: Page, productId: string) {
	if (!bookwalkerAdapter.isProductId(productId))
		throw new Error("Invalid BOOKWALKER ID");
	const snapshot = await page.evaluate(() => {
		const titles = document.querySelectorAll("h1.t-c-product-main-data__title");
		const title =
			titles.length === 1
				? titles[0]?.textContent?.replace(/\s+/g, " ").trim() || null
				: null;
		const fields = Array.from(
			document.querySelectorAll(".t-c-detail-about-information__data > dt"),
		).map((dt) => {
			const dd = dt.nextElementSibling;
			return {
				name: dt.textContent?.replace(/\s+/g, " ").trim() || null,
				text:
					dd?.tagName === "DD"
						? dd.textContent?.replace(/\s+/g, " ").trim() || null
						: null,
				links:
					dd?.tagName === "DD"
						? Array.from(dd.querySelectorAll("a")).map((a) => ({
								text: a.textContent?.replace(/\s+/g, " ").trim() || null,
								url: a.href,
							}))
						: [],
			};
		});
		const synopsis = document.querySelectorAll(
			"#detail-synopsis-main .t-c-synopsis-accordion__text",
		);
		return {
			url: location.href,
			title,
			fields,
			linkedIdentity: Array.from(document.querySelectorAll("a")).some(
				(a) =>
					a.href === location.origin + location.pathname &&
					(a.textContent?.replace(/\s+/g, " ").trim() || null) === title,
			),
			description:
				synopsis.length === 1
					? synopsis[0]?.textContent?.replace(/\s+/g, " ").trim() || null
					: null,
			genres: Array.from(
				document.querySelectorAll(".t-c-detail-about-genre__tag-list a"),
			)
				.map((a) => a.textContent?.replace(/\s+/g, " ").trim() || null)
				.filter((v): v is string => v !== null),
		};
	});
	const source = bookwalkerAdapter.productUrl(productId);
	const url = new URL(snapshot.url);
	if (
		url.origin + url.pathname !== source ||
		!snapshot.title ||
		!snapshot.linkedIdentity
	)
		throw new Error("BOOKWALKER product identity mismatch");
	const field = (name: string) => {
		const matches = snapshot.fields.filter((f) => f.name === name);
		if (matches.length > 1) throw new Error("Ambiguous metadata field");
		return matches[0];
	};
	const publisher = field("出版社")?.text ?? null;
	const categories =
		field("カテゴリ")
			?.links.map((a) => a.text)
			.filter((v): v is string => v !== null) ?? [];
	const seriesField = field("シリーズ");
	let series = null;
	if (seriesField?.links.length === 1) {
		const link = seriesField.links[0];
		if (link?.text) {
			const parsed = new URL(link.url);
			const canonical = parsed.origin + parsed.pathname;
			if (!bookwalkerAdapter.isSeriesUrl(canonical))
				throw new Error("Invalid series URL");
			series = { text: link.text, url: canonical };
		}
	}
	return validateMetadata({
		schemaVersion: 1,
		scope: bookwalkerAdapter.metadataScope,
		store: bookwalkerAdapter.id,
		productId,
		source,
		capturedAt: new Date().toISOString(),
		title: snapshot.title,
		authorsText: field("著者")?.text,
		publisher,
		publicationDateText: null,
		distributionDateText: field("配信開始日")?.text ?? null,
		label: field("レーベル")?.text ?? null,
		description: snapshot.description,
		categories,
		genres: snapshot.genres,
		series,
		missingFields: [
			!publisher && "publisher",
			!snapshot.description && "description",
			!categories.length && "categories",
			!series && "series",
		].filter(Boolean),
	});
}
