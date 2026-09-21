import type { Page } from "playwright";
import { readPurchasePage } from "./purchases.js";

export async function readReadingSample(page: Page, limit: number) {
	const purchase = await readPurchasePage(page, limit);
	const observations = await page.evaluate(() =>
		Array.from(document.querySelectorAll('[id^="content-title-"]')).map(
			(title) => {
				const container = title.closest(".digital_entity_details");
				const valid =
					container?.querySelectorAll('[id^="content-title-"]').length === 1;
				const badges = valid
					? Array.from(container.querySelectorAll('[id="content-read-badge"]'))
					: [];
				const badge = badges.length === 1 ? badges[0] : undefined;
				const visible =
					badge instanceof HTMLElement &&
					badge.checkVisibility({
						checkOpacity: true,
						checkVisibilityCSS: true,
					});
				const text = visible ? (badge.textContent?.trim() ?? null) : null;
				return {
					asin: title.id.slice("content-title-".length),
					kindleReadState: text === "読んだ本" ? "read" : "unknown",
					observedLabel: text,
				};
			},
		),
	);
	const after = await readPurchasePage(page, limit);
	if (
		JSON.stringify(purchase.books) !== JSON.stringify(after.books) ||
		JSON.stringify(purchase.observedRange) !==
			JSON.stringify(after.observedRange) ||
		observations.length !== purchase.observedRange.end ||
		new Set(observations.map((book) => book.asin)).size !== observations.length
	)
		throw new Error("Page changed during reading-state capture");
	return {
		schemaVersion: 1,
		scope: "reading-state-sample",
		complete: false,
		source: purchase.source,
		capturedAt: after.capturedAt,
		requestedLimit: limit,
		observedRange: purchase.observedRange,
		evidenceKind: "amazon-content-read-badge",
		books: purchase.books.map((book) => {
			const observation = observations.find(
				(value) => value.asin === book.asin,
			);
			if (!observation) throw new Error("Missing reading observation");
			return observation;
		}),
	};
}
