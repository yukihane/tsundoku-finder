import { type StoreRegistry, stores } from "../stores/registry.js";
import { libraryPath, readLibrary } from "./database.js";
import { validateBookId } from "./ownership.js";

const columns = `store, product_id AS productId, title, authors_text AS authorsText,
  acquired_date_text AS acquiredDateText, product_url AS productUrl, ownership,
  first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt`;

export function searchBooks(
	query: string,
	limit = 20,
	offset = 0,
	dbPath = libraryPath,
	publisher = "",
) {
	if (
		query.length > 200 ||
		publisher.length > 200 ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 100 ||
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		offset > 100000
	)
		throw new Error("Invalid search arguments");
	const terms = query.trim().split(/\s+/u).filter(Boolean);
	return readLibrary(dbPath, (db) => {
		const hasMetadata =
			Number(db.prepare("PRAGMA user_version").get()?.user_version) >= 2;
		const metadataMatch = hasMetadata
			? ` OR EXISTS (SELECT 1 FROM latest_metadata m WHERE m.store = books.store AND m.product_id = books.product_id AND instr(lower(
      coalesce(json_extract(m.document, '$.title'), '') || char(10) ||
      coalesce(json_extract(m.document, '$.authorsText'), '') || char(10) ||
      coalesce(json_extract(m.document, '$.publisher'), '') || char(10) ||
      coalesce(json_extract(m.document, '$.label'), '') || char(10) ||
      coalesce((SELECT group_concat(value, char(10)) FROM json_each(m.document, '$.genres')), '') || char(10) ||
      coalesce(json_extract(m.document, '$.description'), '') || char(10) ||
      coalesce(json_extract(m.document, '$.series.text'), '') || char(10) ||
      coalesce((SELECT group_concat(value, char(10)) FROM json_each(m.document, '$.categories')), '')
    ), lower(?)) > 0)`
			: "";
		let where = terms.length
			? terms
					.map(
						() =>
							`(instr(lower(title), lower(?)) > 0 OR instr(lower(authors_text), lower(?)) > 0${metadataMatch})`,
					)
					.join(" AND ")
			: "1";
		const parameters = terms.flatMap((term) =>
			hasMetadata ? [term, term, term] : [term, term],
		);
		if (publisher) {
			where += hasMetadata
				? " AND EXISTS (SELECT 1 FROM latest_metadata m WHERE m.store = books.store AND m.product_id = books.product_id AND instr(lower(json_extract(m.document, '$.publisher')), lower(?)) > 0)"
				: " AND 0";
			if (hasMetadata) parameters.push(publisher);
		}
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

export interface BookDetail extends Record<string, unknown> {
	ownershipEvidence: (Record<string, unknown> & { details: unknown }) | null;
	metadata: unknown;
}

export function getBook(
	productId: string,
	store = "kindle-jp",
	dbPath = libraryPath,
	registry: StoreRegistry = stores,
): BookDetail | null {
	validateBookId(store, productId, registry);
	return readLibrary(dbPath, (db) => {
		const book = db
			.prepare(
				`SELECT ${columns} FROM books WHERE store = ? AND product_id = ?`,
			)
			.get(store, productId);
		if (!book) return null;
		const version = Number(
			db.prepare("PRAGMA user_version").get()?.user_version,
		);
		const evidence = db
			.prepare(`SELECT e.source, e.captured_at AS capturedAt,
      e.page_number AS pageNumber, e.category, e.filter, e.kind${version >= 3 ? ", e.details" : ""}
      FROM ownership_evidence e JOIN books b ON b.latest_import_id = e.import_id
        AND b.store = e.store AND b.product_id = e.product_id
      WHERE b.store = ? AND b.product_id = ?`)
			.get(store, productId);
		const metadata =
			Number(db.prepare("PRAGMA user_version").get()?.user_version) >= 2
				? db
						.prepare(
							"SELECT document FROM latest_metadata WHERE store = ? AND product_id = ?",
						)
						.get(store, productId)?.document
				: null;
		return {
			...book,
			ownershipEvidence: evidence
				? {
						...evidence,
						details:
							typeof evidence.details === "string"
								? (JSON.parse(evidence.details) as unknown)
								: {},
					}
				: null,
			metadata:
				typeof metadata === "string" ? (JSON.parse(metadata) as unknown) : null,
		};
	});
}
