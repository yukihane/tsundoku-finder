import type { StoreAdapter } from "../stores/types.js";

export const bookwalkerAdapter: StoreAdapter = {
	id: "bookwalker-jp",
	command: "bookwalker",
	metadataScope: "bookwalker-metadata-sample",
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
