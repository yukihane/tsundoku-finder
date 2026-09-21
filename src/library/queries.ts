import { libraryPath, readLibrary } from "./database.js";

const columns = `store, product_id AS productId, title, authors_text AS authorsText,
  acquired_date_text AS acquiredDateText, product_url AS productUrl, ownership,
  first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt`;

export function searchBooks(
	query: string,
	limit = 20,
	offset = 0,
	dbPath = libraryPath,
) {
	if (
		query.length > 200 ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 100 ||
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		offset > 100000
	)
		throw new Error("Invalid search arguments");
	const terms = query.trim().split(/\s+/u).filter(Boolean);
	const where = terms.length
		? terms
				.map(
					() =>
						"(instr(lower(title), lower(?)) > 0 OR instr(lower(authors_text), lower(?)) > 0)",
				)
				.join(" AND ")
		: "1";
	const parameters = terms.flatMap((term) => [term, term]);
	return readLibrary(dbPath, (db) => {
		const total = Number(
			db
				.prepare(`SELECT count(*) AS count FROM books WHERE ${where}`)
				.get(...parameters)?.count,
		);
		const books = db
			.prepare(
				`SELECT ${columns} FROM books WHERE ${where} ORDER BY store, product_id LIMIT ? OFFSET ?`,
			)
			.all(...parameters, limit, offset);
		return {
			books,
			total,
			limit,
			offset,
			nextOffset: offset + books.length < total ? offset + books.length : null,
		};
	});
}

export function getBook(
	productId: string,
	store = "kindle-jp",
	dbPath = libraryPath,
) {
	if (store !== "kindle-jp" || !/^[A-Z0-9]{10}$/.test(productId))
		throw new Error("Invalid book identifier");
	return readLibrary(dbPath, (db) => {
		const book = db
			.prepare(
				`SELECT ${columns} FROM books WHERE store = ? AND product_id = ?`,
			)
			.get(store, productId);
		if (!book) return null;
		const evidence = db
			.prepare(`SELECT e.source, e.captured_at AS capturedAt,
      e.page_number AS pageNumber, e.category, e.filter, e.kind
      FROM ownership_evidence e JOIN books b ON b.latest_import_id = e.import_id
        AND b.store = e.store AND b.product_id = e.product_id
      WHERE b.store = ? AND b.product_id = ?`)
			.get(store, productId);
		return { ...book, ownershipEvidence: evidence ?? null };
	});
}
