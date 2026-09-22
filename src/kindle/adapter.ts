import type { StoreAdapter } from "../stores/types.js";

export const kindleAdapter: StoreAdapter = {
	id: "kindle-jp",
	command: "kindle",
	metadataScope: "kindle-metadata-sample",
	isProductId: (id) => /^[A-Z0-9]{10}$/.test(id),
	productUrl: (id) => `https://www.amazon.co.jp/dp/${id}`,
	isSeriesUrl: (url) =>
		/^https:\/\/www\.amazon\.co\.jp\/dp\/[A-Z0-9]{10}$/.test(url),
	validateMetadataFormat(value) {
		if (
			typeof value.authorsText !== "string" ||
			!/形式\s*:\s*Kindle版/.test(value.authorsText)
		)
			throw new Error("Not Kindle metadata");
	},
	async readMetadata(page, id) {
		return (await import("../metadata/kindle.js")).readKindleMetadata(page, id);
	},
	async waitForMetadata(page) {
		await page
			.locator("#detailBulletsWrapper_feature_div")
			.waitFor({ timeout: 30000 });
	},
};
