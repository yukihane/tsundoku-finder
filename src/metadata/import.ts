import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { initialize, libraryPath, readLibrary } from "../library/database.js";
import { type StoreRegistry, stores } from "../stores/registry.js";

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid metadata object");
	return value as Record<string, unknown>;
}
function text(value: unknown, nullable = false): string | null {
	if (nullable && value === null) return null;
	if (typeof value !== "string" || !value.trim() || value.length > 100000)
		throw new Error("Invalid metadata text");
	return value;
}
export function validateMetadata(
	input: unknown,
	registry: StoreRegistry = stores,
) {
	const value = object(input);
	const adapter = registry.get(String(value.store));
	if (value.schemaVersion !== 1 || value.scope !== adapter.metadataScope)
		throw new Error("Unknown metadata format");
	adapter.validateMetadataFormat(value);
	const productId = text(value.productId);
	const capturedAt = text(value.capturedAt);
	if (
		!productId ||
		!adapter.isProductId(productId) ||
		!capturedAt ||
		!Number.isFinite(Date.parse(capturedAt)) ||
		new Date(capturedAt).toISOString() !== capturedAt ||
		value.source !== adapter.productUrl(productId, String(value.source))
	)
		throw new Error("Invalid metadata identity");
	const title = text(value.title);
	const authorsText = text(value.authorsText);
	const publisher = text(value.publisher, true);
	const description = text(value.description, true);
	const publicationDateText = text(value.publicationDateText, true);
	if (!Array.isArray(value.categories) || value.categories.length > 100)
		throw new Error("Invalid categories");
	const categories = value.categories.map((item) => text(item));
	let series: { text: string | null; url: string } | null = null;
	if (value.series !== null) {
		const item = object(value.series);
		if (typeof item.url !== "string" || !adapter.isSeriesUrl(item.url))
			throw new Error("Invalid series URL");
		series = { text: text(item.text), url: item.url };
	}
	const missingFields = [
		!publisher && "publisher",
		!description && "description",
		!categories.length && "categories",
		!series && "series",
	].filter((item): item is string => Boolean(item));
	if (JSON.stringify(value.missingFields) !== JSON.stringify(missingFields))
		throw new Error("Inconsistent missing fields");
	return {
		schemaVersion: 1,
		scope: adapter.metadataScope,
		store: adapter.id,
		productId,
		source: value.source,
		capturedAt,
		title,
		authorsText,
		publisher,
		description,
		publicationDateText,
		categories,
		series,
		missingFields,
		...(value.label !== undefined ? { label: text(value.label, true) } : {}),
		...(value.distributionDateText !== undefined
			? { distributionDateText: text(value.distributionDateText, true) }
			: {}),
		...(value.genres !== undefined ? { genres: stringList(value.genres) } : {}),
	};
}

function stringList(value: unknown) {
	if (!Array.isArray(value) || value.length > 100)
		throw new Error("Invalid list");
	return value.map((item) => text(item));
}

export async function importMetadata(
	filename: string,
	dbPath = libraryPath,
	registry: StoreRegistry = stores,
) {
	if ((await stat(filename)).size > 1000000)
		throw new Error("Metadata file too large");
	const data = validateMetadata(
		JSON.parse(await readFile(filename, "utf8")),
		registry,
	);
	const document = JSON.stringify(data);
	const id = createHash("sha256").update(document).digest("hex");
	// Verify existing database without creating or migrating anything first.
	readLibrary(dbPath, () => undefined);
	const db = new DatabaseSync(dbPath, {
		timeout: 5000,
		enableForeignKeyConstraints: true,
	});
	try {
		db.exec("BEGIN IMMEDIATE");
		try {
			initialize(db);
			const owned = db
				.prepare(
					"SELECT product_url FROM books WHERE store = ? AND product_id = ?",
				)
				.get(data.store, data.productId);
			if (!owned || owned.product_url !== data.source)
				throw new Error("Unowned book or mismatched product URL");
			if (
				db.prepare("SELECT id FROM metadata_snapshots WHERE id = ?").get(id)
			) {
				db.exec("COMMIT");
				return { alreadyImported: true };
			}
			db.prepare("INSERT INTO metadata_snapshots VALUES (?, ?, ?, ?, ?)").run(
				id,
				data.store,
				data.productId,
				data.capturedAt,
				document,
			);
			db.exec("COMMIT");
			return { alreadyImported: false };
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	} finally {
		db.close();
	}
}

export function metadataSummary(dbPath = libraryPath) {
	return readLibrary(dbPath, (db) => {
		const total = Number(
			db.prepare("SELECT count(*) AS n FROM books").get()?.n,
		);
		if (db.prepare("PRAGMA user_version").get()?.user_version === 1)
			return { total, captured: 0, pending: total, snapshots: 0 };
		const captured = Number(
			db.prepare("SELECT count(*) AS n FROM latest_metadata").get()?.n,
		);
		return {
			total,
			captured,
			pending: total - captured,
			snapshots: Number(
				db.prepare("SELECT count(*) AS n FROM metadata_snapshots").get()?.n,
			),
		};
	});
}
