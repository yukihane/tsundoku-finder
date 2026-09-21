export type Store = "kindle-jp" | "bookwalker-jp";

export function validateBookId(store: string, productId: string): void {
	const valid =
		store === "kindle-jp"
			? /^[A-Z0-9]{10}$/.test(productId)
			: store === "bookwalker-jp" &&
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
					productId,
				);
	if (!valid) throw new Error("Invalid book identifier");
}

// Internal input only. Store adapters must validate the original files first.
export interface OwnershipImport {
	id: string;
	store: Store;
	startedAt: string;
	completedAt: string;
	coverage: {
		status: "partial" | "complete";
		scope: "kindle-purchased-list" | "bookwalker-holdbooks";
	};
	books: Array<{
		productId: string;
		title: string;
		authorsText: string;
		acquiredDateText: string;
		productUrl: string;
		evidence: {
			source: string;
			capturedAt: string;
			pageNumber: number;
			kind: "amazon-content-filter" | "bookwalker-holdbooks";
			category: string | null;
			filter: string | null;
		};
	}>;
}

function timestamp(value: string): boolean {
	return (
		typeof value === "string" &&
		Number.isFinite(Date.parse(value)) &&
		new Date(value).toISOString() === value
	);
}

export function validateOwnership(input: OwnershipImport): void {
	const kindle = input.store === "kindle-jp";
	if (
		!/^[a-f0-9]{64}$/.test(input.id) ||
		!timestamp(input.startedAt) ||
		!timestamp(input.completedAt) ||
		input.startedAt > input.completedAt ||
		!Array.isArray(input.books) ||
		input.books.length < 1 ||
		input.books.length > 25000 ||
		input.coverage.scope !==
			(kindle ? "kindle-purchased-list" : "bookwalker-holdbooks") ||
		input.coverage.status !== (kindle ? "complete" : "partial")
	)
		throw new Error("Invalid ownership import");
	const seen = new Set<string>();
	for (const book of input.books) {
		validateBookId(input.store, book.productId);
		const e = book.evidence;
		const productUrl = kindle
			? `https://www.amazon.co.jp/dp/${book.productId}`
			: `https://bookwalker.jp/de${book.productId}/`;
		const source = kindle
			? `https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksPurchases/dateDsc${e.pageNumber === 1 ? "" : `?pageNumber=${e.pageNumber}`}`
			: "https://bookwalker.jp/holdBooks/";
		if (
			seen.has(book.productId) ||
			book.productUrl !== productUrl ||
			![book.title, book.acquiredDateText].every(
				(v) => typeof v === "string" && v.trim() && v.length <= 100000,
			) ||
			typeof book.authorsText !== "string" ||
			book.authorsText.length > 100000 ||
			!timestamp(e.capturedAt) ||
			e.capturedAt < input.startedAt ||
			e.capturedAt > input.completedAt ||
			!Number.isSafeInteger(e.pageNumber) ||
			e.pageNumber < 1 ||
			e.source !== source ||
			e.kind !== (kindle ? "amazon-content-filter" : "bookwalker-holdbooks") ||
			e.category !== (kindle ? "本" : null) ||
			e.filter !== (kindle ? "購入済み" : null)
		)
			throw new Error("Invalid ownership book");
		seen.add(book.productId);
	}
}
