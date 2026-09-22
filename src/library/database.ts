import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type StoreRegistry, stores } from "../stores/registry.js";
import { type OwnershipImport, validateOwnership } from "./ownership.js";

export const libraryPath = fileURLToPath(
	new URL("../../.local/library.sqlite", import.meta.url),
);
const applicationId = 0x54534e44;

export function initialize(db: DatabaseSync): void {
	const version = db.prepare("PRAGMA user_version").get()?.user_version;
	const app = db.prepare("PRAGMA application_id").get()?.application_id;
	if (version === 3 && app === applicationId) return;
	if (version === 2 && app === applicationId) {
		db.exec(`ALTER TABLE imports ADD COLUMN coverage TEXT CHECK(coverage IS NULL OR json_valid(coverage));
      CREATE TABLE ownership_evidence_v3 (
        import_id TEXT NOT NULL REFERENCES imports(id), store TEXT NOT NULL, product_id TEXT NOT NULL,
        page_number INTEGER NOT NULL, source TEXT NOT NULL, captured_at TEXT NOT NULL,
        category TEXT, filter TEXT, kind TEXT NOT NULL,
        details TEXT NOT NULL CHECK(json_valid(details)),
        PRIMARY KEY(import_id, store, product_id),
        FOREIGN KEY(store, product_id) REFERENCES books(store, product_id)
      ) STRICT;
      INSERT INTO ownership_evidence_v3 SELECT *, '{}' FROM ownership_evidence;
      DROP TABLE ownership_evidence;
      ALTER TABLE ownership_evidence_v3 RENAME TO ownership_evidence;
      PRAGMA user_version = 3;`);
		return;
	}
	if (version === 1 && app === applicationId) {
		db.exec(`CREATE TABLE metadata_snapshots (
      id TEXT PRIMARY KEY, store TEXT NOT NULL, product_id TEXT NOT NULL,
      captured_at TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
      UNIQUE(store, product_id, captured_at),
      FOREIGN KEY(store, product_id) REFERENCES books(store, product_id)
    ) STRICT;
    CREATE VIEW latest_metadata AS SELECT m.* FROM metadata_snapshots m
      WHERE NOT EXISTS (SELECT 1 FROM metadata_snapshots newer
        WHERE newer.store = m.store AND newer.product_id = m.product_id AND newer.captured_at > m.captured_at);
    PRAGMA user_version = 2;`);
		initialize(db);
		return;
	}
	if (
		version !== 0 ||
		app !== 0 ||
		db
			.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
			.all().length
	)
		throw new Error("Unsupported database");
	db.exec(`
    CREATE TABLE imports (
      id TEXT PRIMARY KEY, source_store TEXT NOT NULL, started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL, imported_at TEXT NOT NULL, book_count INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE books (
      store TEXT NOT NULL, product_id TEXT NOT NULL, title TEXT NOT NULL,
      authors_text TEXT NOT NULL, acquired_date_text TEXT NOT NULL, product_url TEXT NOT NULL,
      ownership TEXT NOT NULL CHECK(ownership = 'purchased'),
      first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
      latest_import_id TEXT NOT NULL REFERENCES imports(id), PRIMARY KEY(store, product_id)
    ) STRICT;
    CREATE TABLE ownership_evidence (
      import_id TEXT NOT NULL REFERENCES imports(id), store TEXT NOT NULL, product_id TEXT NOT NULL,
      page_number INTEGER NOT NULL, source TEXT NOT NULL, captured_at TEXT NOT NULL,
      category TEXT NOT NULL, filter TEXT NOT NULL, kind TEXT NOT NULL,
      PRIMARY KEY(import_id, store, product_id),
      FOREIGN KEY(store, product_id) REFERENCES books(store, product_id)
    ) STRICT;
    PRAGMA application_id = ${applicationId};
    PRAGMA user_version = 1;
  `);
	initialize(db);
}

function storeImport(db: DatabaseSync, input: OwnershipImport) {
	const count = () =>
		Number(db.prepare("SELECT count(*) AS count FROM books").get()?.count);
	db.exec("BEGIN IMMEDIATE");
	try {
		initialize(db);
		const existing = db
			.prepare("SELECT source_store FROM imports WHERE id = ?")
			.get(input.id);
		if (existing) {
			if (existing.source_store !== input.store)
				throw new Error("Import identity belongs to another store");
			const total = count();
			db.exec("COMMIT");
			return { alreadyImported: true, imported: 0, total };
		}
		db.prepare(
			"INSERT INTO imports (id, source_store, started_at, completed_at, imported_at, book_count, coverage) VALUES (?, ?, ?, ?, ?, ?, ?)",
		).run(
			input.id,
			input.store,
			input.startedAt,
			input.completedAt,
			new Date().toISOString(),
			input.books.length,
			JSON.stringify(input.coverage),
		);
		const upsert =
			db.prepare(`INSERT INTO books (store, product_id, title, authors_text, acquired_date_text, product_url, ownership, first_seen_at, last_seen_at, latest_import_id) VALUES (?, ?, ?, ?, ?, ?, 'purchased', ?, ?, ?)
      ON CONFLICT(store, product_id) DO UPDATE SET
        title = CASE WHEN excluded.last_seen_at > books.last_seen_at THEN excluded.title ELSE books.title END,
        authors_text = CASE WHEN excluded.last_seen_at > books.last_seen_at THEN excluded.authors_text ELSE books.authors_text END,
        acquired_date_text = CASE WHEN excluded.last_seen_at > books.last_seen_at THEN excluded.acquired_date_text ELSE books.acquired_date_text END,
        product_url = CASE WHEN excluded.last_seen_at > books.last_seen_at THEN excluded.product_url ELSE books.product_url END,
        first_seen_at = min(books.first_seen_at, excluded.first_seen_at),
        last_seen_at = max(books.last_seen_at, excluded.last_seen_at),
        latest_import_id = CASE WHEN excluded.last_seen_at > books.last_seen_at THEN excluded.latest_import_id ELSE books.latest_import_id END`);
		const evidence = db.prepare(
			"INSERT INTO ownership_evidence (import_id, store, product_id, page_number, source, captured_at, category, filter, kind, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		);
		for (const book of input.books) {
			const observedBook = {
				title: book.title,
				authorsText: book.authorsText,
				acquiredDateText: book.acquiredDateText,
				productUrl: book.productUrl,
			};
			const previous = db
				.prepare(
					"SELECT details FROM ownership_evidence WHERE store = ? AND product_id = ? AND captured_at = ?",
				)
				.all(input.store, book.productId, book.evidence.capturedAt);
			for (const row of previous) {
				const saved = JSON.parse(String(row.details)).observedBook;
				if (saved) {
					if (
						Object.entries(observedBook).some(
							([key, value]) => saved[key] !== value,
						)
					)
						throw new Error("Conflicting ownership observation");
				} else {
					// Legacy evidence has no historical book snapshot. Compare only when the current row is from that observation.
					const current = db
						.prepare(
							"SELECT title, authors_text, acquired_date_text, product_url, last_seen_at FROM books WHERE store = ? AND product_id = ?",
						)
						.get(input.store, book.productId);
					if (
						!current ||
						current.last_seen_at !== book.evidence.capturedAt ||
						current.title !== book.title ||
						current.authors_text !== book.authorsText ||
						current.acquired_date_text !== book.acquiredDateText ||
						current.product_url !== book.productUrl
					)
						throw new Error("Unverifiable legacy ownership observation");
				}
			}
			upsert.run(
				input.store,
				book.productId,
				book.title,
				book.authorsText,
				book.acquiredDateText,
				book.productUrl,
				book.evidence.capturedAt,
				book.evidence.capturedAt,
				input.id,
			);
			evidence.run(
				input.id,
				input.store,
				book.productId,
				book.evidence.pageNumber,
				book.evidence.source,
				book.evidence.capturedAt,
				book.evidence.category,
				book.evidence.filter,
				book.evidence.kind,
				JSON.stringify({
					observedBook,
					...(book.evidence.display ? { display: book.evidence.display } : {}),
				}),
			);
		}
		const total = count();
		db.exec("COMMIT");
		return { alreadyImported: false, imported: input.books.length, total };
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

export async function importOwnership(
	input: OwnershipImport,
	dbPath = libraryPath,
	registry: StoreRegistry = stores,
) {
	validateOwnership(input, registry);
	// Snapshot before the first await so callers cannot mutate validated input while opening the DB.
	const validated = structuredClone(input);
	await mkdir(dirname(dbPath), { recursive: true });
	const db = new DatabaseSync(dbPath, {
		timeout: 5000,
		enableForeignKeyConstraints: true,
	});
	try {
		return storeImport(db, validated);
	} finally {
		db.close();
	}
}

export function readLibrary<T>(
	dbPath: string,
	read: (db: DatabaseSync) => T,
): T {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		if (
			db.prepare("PRAGMA application_id").get()?.application_id !==
				applicationId ||
			![1, 2, 3].includes(
				Number(db.prepare("PRAGMA user_version").get()?.user_version),
			)
		)
			throw new Error("Unsupported database");
		return read(db);
	} finally {
		db.close();
	}
}

export function librarySummary(dbPath = libraryPath) {
	return readLibrary(dbPath, (db) => ({
		books: Number(
			db.prepare("SELECT count(*) AS count FROM books").get()?.count,
		),
		imports: Number(
			db.prepare("SELECT count(*) AS count FROM imports").get()?.count,
		),
		evidence: Number(
			db.prepare("SELECT count(*) AS count FROM ownership_evidence").get()
				?.count,
		),
	}));
}
