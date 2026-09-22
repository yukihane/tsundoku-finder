import type { StoreAdapter } from "../stores/types.js";
import { canonicalProductUrl, isProductId } from "./identity.js";
import { validateDmmOwnership } from "./import.js";

export const dmmAdapter: StoreAdapter = {
	id: "dmm-books",
	command: "dmm",
	metadataScope: "dmm-metadata-sample",
	isProductId,
	productUrl: canonicalProductUrl,
	validateOwnership: validateDmmOwnership,
	isSeriesUrl: (url) =>
		/^https:\/\/book\.dmm\.com\/product\/[1-9]\d*\/(?:[a-z0-9_]+|volumes)\/$/.test(
			url,
		),
	validateMetadataFormat(value) {
		if (
			!("label" in value) ||
			!("distributionDateText" in value) ||
			!Array.isArray(value.genres)
		)
			throw new Error("Incomplete DMM metadata");
	},
	async readMetadata(page, id) {
		return (await import("./metadata.js")).readDmmMetadata(page, id);
	},
	async waitForMetadata(page) {
		await page
			.locator('[data-testid="volume-detail-info"]')
			.waitFor({ timeout: 30000 });
	},
};
