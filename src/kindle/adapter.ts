import type { StoreAdapter } from "../stores/types.js";

export const kindleAdapter: StoreAdapter = {
	id: "kindle-jp",
	command: "kindle",
	metadataScope: "kindle-metadata-sample",
	validateOwnership(input) {
		if (
			input.coverage.scope !== "kindle-purchased-list" ||
			input.coverage.status !== "complete"
		)
			throw new Error("Invalid kindle coverage");
		for (const book of input.books) {
			const e = book.evidence;
			if (
				book.acquiredDateText === null ||
				e.source !==
					`https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksPurchases/dateDsc${e.pageNumber === 1 ? "" : `?pageNumber=${e.pageNumber}`}` ||
				e.kind !== "amazon-content-filter" ||
				e.category !== "本" ||
				e.filter !== "購入済み"
			)
				throw new Error("Invalid kindle ownership evidence");
		}
	},
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
