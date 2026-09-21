import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type KindleImport, readKindleImport } from "../kindle/import-data.js";

export const libraryPath = fileURLToPath(
	new URL("../../.local/library.sqlite", import.meta.url),
);
const applicationId = 0x54534e44;

function initialize(db: DatabaseSync): void {
	const version = db.prepare("PRAGMA user_version").get()?.user_version;
	const app = db.prepare("PRAGMA application_id").get()?.application_id;
	if (version === 1 && app === applicationId) return;
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
}

function storeImport(db: DatabaseSync, input: KindleImport) {
	const count = () =>
		Number(db.prepare("SELECT count(*) AS count FROM books").get()?.count);
	db.exec("BEGIN IMMEDIATE");
	try {
		initialize(db);
		if (db.prepare("SELECT id FROM imports WHERE id = ?").get(input.id)) {
			const total = count();
			db.exec("COMMIT");
			return { alreadyImported: true, imported: 0, total };
		}
		db.prepare("INSERT INTO imports VALUES (?, ?, ?, ?, ?, ?)").run(
			input.id,
			"kindle-jp",
			input.startedAt,
			input.completedAt,
			new Date().toISOString(),
			input.books.length,
		);
		const upsert =
			db.prepare(`INSERT INTO books VALUES (?, ?, ?, ?, ?, ?, 'purchased', ?, ?, ?)
      ON CONFLICT(store, product_id) DO UPDATE SET
        title = CASE WHEN excluded.last_seen_at > books.last_seen_at THEN excluded.title ELSE books.title END,
        authors_text = CASE WHEN excluded.last_seen_at > books.last_seen_at THEN excluded.authors_text ELSE books.authors_text END,
        acquired_date_text = CASE WHEN excluded.last_seen_at > books.last_seen_at THEN excluded.acquired_date_text ELSE books.acquired_date_text END,
        product_url = CASE WHEN excluded.last_seen_at > books.last_seen_at THEN excluded.product_url ELSE books.product_url END,
        first_seen_at = min(books.first_seen_at, excluded.first_seen_at),
        last_seen_at = max(books.last_seen_at, excluded.last_seen_at),
        latest_import_id = CASE WHEN excluded.last_seen_at > books.last_seen_at THEN excluded.latest_import_id ELSE books.latest_import_id END`);
		const evidence = db.prepare(
			"INSERT INTO ownership_evidence VALUES (?, 'kindle-jp', ?, ?, ?, ?, '本', '購入済み', 'amazon-content-filter')",
		);
		for (const book of input.books) {
			upsert.run(
				"kindle-jp",
				book.asin,
				book.title,
				book.authorsText,
				book.acquiredDateText,
				book.productUrl,
				book.capturedAt,
				book.capturedAt,
				input.id,
			);
			evidence.run(
				input.id,
				book.asin,
				book.pageNumber,
				book.source,
				book.capturedAt,
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

export async function importKindleCollection(
	directory: string,
	dbPath = libraryPath,
) {
	const input = await readKindleImport(directory);
	await mkdir(dirname(dbPath), { recursive: true });
	const db = new DatabaseSync(dbPath, {
		timeout: 5000,
		enableForeignKeyConstraints: true,
	});
	try {
		return storeImport(db, input);
	} finally {
		db.close();
	}
}

export function librarySummary(dbPath = libraryPath) {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		if (
			db.prepare("PRAGMA application_id").get()?.application_id !==
				applicationId ||
			db.prepare("PRAGMA user_version").get()?.user_version !== 1
		)
			throw new Error("Unsupported database");
		return {
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
		};
	} finally {
		db.close();
	}
}
