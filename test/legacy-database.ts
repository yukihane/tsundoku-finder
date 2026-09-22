import type { DatabaseSync } from "node:sqlite";

// Recreate the actual legacy schema, not just its version marker.
export function legacySchema(db: DatabaseSync, version: 1 | 2): void {
	db.exec(`BEGIN;
    DROP TABLE metadata_tasks;
    DROP TABLE metadata_runs;
    ALTER TABLE imports DROP COLUMN coverage;
    CREATE TABLE legacy_evidence (
      import_id TEXT NOT NULL REFERENCES imports(id), store TEXT NOT NULL, product_id TEXT NOT NULL,
      page_number INTEGER NOT NULL, source TEXT NOT NULL, captured_at TEXT NOT NULL,
      category TEXT NOT NULL, filter TEXT NOT NULL, kind TEXT NOT NULL,
      PRIMARY KEY(import_id, store, product_id),
      FOREIGN KEY(store, product_id) REFERENCES books(store, product_id)
    ) STRICT;
    INSERT INTO legacy_evidence SELECT import_id, store, product_id, page_number, source, captured_at, category, filter, kind FROM ownership_evidence;
    DROP TABLE ownership_evidence;
    ALTER TABLE legacy_evidence RENAME TO ownership_evidence;
    PRAGMA user_version = ${version};`);
	if (version === 1)
		db.exec("DROP VIEW latest_metadata; DROP TABLE metadata_snapshots;");
	db.exec("COMMIT");
}
