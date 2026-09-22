import { type StoreRegistry, stores } from "../stores/registry.js";
export function validateBookId(
	store: string,
	productId: string,
	registry: StoreRegistry = stores,
): void {
	if (
		typeof productId !== "string" ||
		!registry.get(store).isProductId(productId)
	)
		throw new Error("Invalid book identifier");
}

// Internal input only. Store adapters must validate the original files first.
export interface OwnershipImport {
	id: string;
	store: string;
	startedAt: string;
	completedAt: string;
	coverage: {
		status: "partial" | "complete";
		scope: string;
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
			kind: string;
			category: string | null;
			filter: string | null;
			display?: Record<string, unknown>;
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

export function validateOwnership(
	input: OwnershipImport,
	registry: StoreRegistry = stores,
): void {
	const adapter = registry.get(input.store);
	if (
		!/^[a-f0-9]{64}$/.test(input.id) ||
		!timestamp(input.startedAt) ||
		!timestamp(input.completedAt) ||
		input.startedAt > input.completedAt ||
		!Array.isArray(input.books) ||
		input.books.length < 1 ||
		input.books.length > 25000 ||
		typeof input.coverage.scope !== "string" ||
		!input.coverage.scope.trim() ||
		!["partial", "complete"].includes(input.coverage.status)
	)
		throw new Error("Invalid ownership import");
	const seen = new Set<string>();
	for (const book of input.books) {
		validateBookId(input.store, book.productId, registry);
		const e = book.evidence;
		if (
			seen.has(book.productId) ||
			book.productUrl !== adapter.productUrl(book.productId) ||
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
			![e.source, e.kind].every(
				(v) => typeof v === "string" && v.trim() && v.length <= 100000,
			) ||
			![e.category, e.filter].every(
				(v) => v === null || (typeof v === "string" && v.length <= 100000),
			)
		)
			throw new Error("Invalid ownership book");
		seen.add(book.productId);
	}
	adapter.validateOwnership(input);
}
