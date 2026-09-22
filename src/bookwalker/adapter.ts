import type { StoreAdapter } from "../stores/types.js";

export const bookwalkerAdapter: StoreAdapter = {
	id: "bookwalker-jp",
	command: "bookwalker",
	metadataScope: "bookwalker-metadata-sample",
	validateOwnership(input) {
		if (
			input.coverage.scope !== "bookwalker-holdbooks" ||
			input.coverage.status !== "partial"
		)
			throw new Error("Invalid bookwalker coverage");
		for (const book of input.books) {
			const e = book.evidence;
			if (
				e.source !== "https://bookwalker.jp/holdBooks/" ||
				e.kind !== "bookwalker-holdbooks" ||
				e.category !== null ||
				e.filter !== null ||
				e.pageNumber !== 1
			)
				throw new Error("Invalid bookwalker ownership evidence");
		}
	},
	isProductId: (id) =>
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id),
	productUrl: (id) => `https://bookwalker.jp/de${id}/`,
	isSeriesUrl: (url) =>
		/^https:\/\/bookwalker\.jp\/series\/\d+\/list\/$/.test(url),
	validateMetadataFormat(value) {
		if (
			!("label" in value) ||
			!("distributionDateText" in value) ||
			!Array.isArray(value.genres)
		)
			throw new Error("Incomplete BOOKWALKER metadata format");
	},
	async readMetadata(page, id) {
		return (await import("./metadata.js")).readBookwalkerMetadata(page, id);
	},
	async waitForMetadata(page) {
		await page
			.locator(".t-c-detail-about-information__data")
			.first()
			.waitFor({ timeout: 30000 });
		const button = page.locator('button[aria-controls="detail-synopsis-main"]');
		if (
			(await button.count()) === 1 &&
			(await button.getAttribute("aria-expanded")) === "false"
		)
			await button.click();
	},
};
