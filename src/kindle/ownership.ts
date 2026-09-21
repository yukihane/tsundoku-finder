import type { OwnershipImport } from "../library/ownership.js";
import type { KindleImport } from "./import-data.js";

export function kindleOwnership(input: KindleImport): OwnershipImport {
	return {
		id: input.id,
		store: "kindle-jp",
		startedAt: input.startedAt,
		completedAt: input.completedAt,
		coverage: { status: "complete", scope: "kindle-purchased-list" },
		books: input.books.map((book) => ({
			productId: book.asin,
			title: book.title,
			authorsText: book.authorsText,
			acquiredDateText: book.acquiredDateText,
			productUrl: book.productUrl,
			evidence: {
				source: book.source,
				capturedAt: book.capturedAt,
				pageNumber: book.pageNumber,
				kind: "amazon-content-filter",
				category: "本",
				filter: "購入済み",
			},
		})),
	};
}
