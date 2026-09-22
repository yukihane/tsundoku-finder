import type { StoreAdapter } from "../stores/types.js";

export const bookwalkerAdapter: StoreAdapter = {
	id: "bookwalker-jp",
	command: "bookwalker",
	metadataScope: "bookwalker-metadata-sample",
	validateOwnership(input) {
		if (input.coverage.scope !== "bookwalker-holdbooks")
			throw new Error("Invalid bookwalker coverage");
		if (input.coverage.status === "complete") {
			const total = Number(
				String(input.books[0]?.evidence.display?.heading)
					.match(/\(([\d,]+)件\)/)?.[1]
					?.replaceAll(",", ""),
			);
			if (total !== input.books.length)
				throw new Error("Incomplete BOOKWALKER coverage");
		}
		for (const book of input.books) {
			const e = book.evidence;
			if (
				book.acquiredDateText === null ||
				e.source !==
					(e.pageNumber === 1
						? "https://bookwalker.jp/holdBooks/"
						: `https://bookwalker.jp/holdBooks/?page=${e.pageNumber}`) ||
				e.kind !== "bookwalker-holdbooks" ||
				e.category !== null ||
				e.filter !== null
			)
				throw new Error("Invalid bookwalker ownership evidence");
		}
	},
	isProductId: (id) =>
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id),
	productUrl: (id, observedUrl) => {
		const normal = `https://bookwalker.jp/de${id}/`;
		const adult = `https://r18.bookwalker.jp/de${id}/`;
		if (
			observedUrl !== undefined &&
			observedUrl !== normal &&
			observedUrl !== adult
		)
			throw new Error("Invalid BOOKWALKER product URL");
		return observedUrl ?? normal;
	},
	isSeriesUrl: (url) =>
		/^https:\/\/(?:r18\.)?bookwalker\.jp\/series\/\d+\/list\/$/.test(url),
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
			(await button.isVisible()) &&
			(await button.getAttribute("aria-expanded")) === "false"
		)
			await button.click();
	},
};
