export const shelfUrl = "https://book.dmm.com/shelf/";
export const isProductId = (id: string) =>
	/^[a-z0-9][a-z0-9_]{1,99}$/.test(id) && !["latest", "volumes"].includes(id);

export function productIdentity(url: string) {
	const match =
		/^https:\/\/book\.dmm\.com\/product\/([1-9]\d*)\/([a-z0-9_]+)\/$/.exec(url);
	if (!match?.[1] || !match[2] || !isProductId(match[2]))
		throw new Error("Invalid DMM product URL");
	return { seriesId: match[1], productId: match[2] };
}

export function volumeUrl(seriesId: string) {
	if (!/^[1-9]\d*$/.test(seriesId)) throw new Error("Invalid DMM series ID");
	return `https://book.dmm.com/product/${seriesId}/volumes/?tab=purchased`;
}

export function canonicalProductUrl(id: string, url?: string) {
	if (!url || productIdentity(url).productId !== id)
		throw new Error("DMM product ID and observed URL do not match");
	return url;
}
