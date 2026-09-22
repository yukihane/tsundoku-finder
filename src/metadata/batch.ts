import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { initialize, libraryPath, readLibrary } from "../library/database.js";
import { lockFile } from "../local-files.js";
import { stores } from "../stores/registry.js";
import { CaptureFailure, captureOnPage } from "./capture.js";
import { importMetadata, validateMetadata } from "./import.js";

export type BatchOptions = {
	store?: string;
	product?: string;
	resume?: string;
	refresh?: boolean;
	retry?: boolean;
	limit?: number;
	intervalMs?: number;
};
type Task = {
	store: string;
	product_id: string;
	product_url: string;
	filename: string;
	attempts: number;
};
export type Worker = (task: Task) => Promise<void>;
function transaction<T>(db: DatabaseSync, action: () => T) {
	db.exec("BEGIN IMMEDIATE");
	try {
		const result = action();
		db.exec("COMMIT");
		return result;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}
export function prepareBatch(db: DatabaseSync, options: BatchOptions) {
	if (
		options.resume &&
		(options.store || options.product || options.refresh || options.retry)
	)
		throw new Error("Resume cannot change selection");
	if (options.refresh && options.retry)
		throw new Error("Choose refresh or retry");
	const store = options.store ? stores.command(options.store).id : null;
	if (
		options.product &&
		(!store || !stores.get(store).isProductId(options.product))
	)
		throw new Error("Product requires a matching store");
	return transaction(db, () => {
		initialize(db);
		const now = new Date().toISOString();
		if (options.resume) {
			const run = db
				.prepare("SELECT id FROM metadata_runs WHERE id = ?")
				.get(options.resume);
			if (!run) throw new Error("Unknown run");
			db.prepare(
				"UPDATE metadata_tasks SET status = 'pending' WHERE run_id = ? AND status = 'running'",
			).run(options.resume);
			db.prepare(
				"UPDATE metadata_runs SET status = 'running', updated_at = ? WHERE id = ?",
			).run(now, options.resume);
			return options.resume;
		}
		const id = randomUUID();
		db.prepare("INSERT INTO metadata_runs VALUES (?, ?, ?, 'running', ?)").run(
			id,
			now,
			now,
			JSON.stringify(options),
		);
		const rows = db
			.prepare(`SELECT b.store, b.product_id FROM books b
			WHERE (? IS NULL OR b.store = ?) AND (? IS NULL OR b.product_id = ?)
			AND (? = 1 OR NOT EXISTS (SELECT 1 FROM latest_metadata m WHERE m.store = b.store AND m.product_id = b.product_id))
			AND (? = 1 OR ? = 1 OR NOT EXISTS (SELECT 1 FROM metadata_tasks t WHERE t.store = b.store AND t.product_id = b.product_id AND t.status IN ('failed','unsupported')))
			ORDER BY b.store, b.product_id`)
			.all(
				store,
				store,
				options.product ?? null,
				options.product ?? null,
				Number(!!options.refresh),
				Number(!!options.refresh),
				Number(!!options.retry),
			);
		const insert = db.prepare(
			"INSERT INTO metadata_tasks (run_id, store, product_id, status, updated_at) VALUES (?, ?, ?, 'pending', ?)",
		);
		for (const row of rows)
			insert.run(id, String(row.store), String(row.product_id), now);
		return id;
	});
}

export async function runBatch(
	options: BatchOptions,
	dbPath = libraryPath,
	injectedWorker?: Worker,
) {
	const limit = options.limit ?? 25;
	const interval = options.intervalMs ?? 3000;
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 25000 ||
		!Number.isSafeInteger(interval) ||
		interval < 3000 ||
		interval > 60000
	)
		throw new Error("Invalid batch limit or interval");
	readLibrary(dbPath, () => undefined);
	const unlock = await lockFile(`${resolve(dbPath)}.metadata.lock`);
	const db = new DatabaseSync(dbPath, {
		timeout: 5000,
		enableForeignKeyConstraints: true,
	});
	let id: string | undefined;
	let stopped = false;
	const stop = () => {
		stopped = true;
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
	try {
		id = prepareBatch(db, options);
		console.log(`書誌処理ID: ${id}`);
		const run = db
			.prepare("SELECT options FROM metadata_runs WHERE id = ?")
			.get(id);
		const original = JSON.parse(String(run?.options)) as BatchOptions;
		const queue = db
			.prepare(`SELECT t.*, b.product_url FROM metadata_tasks t JOIN books b USING(store, product_id)
			WHERE run_id = ? AND status = 'pending' ORDER BY t.store, t.product_id LIMIT ?`)
			.all(id, limit);
		let worker = injectedWorker;
		if (!worker && queue.length) {
			browser = await chromium.launch({ headless: true });
			const page = await browser.newPage({ locale: "ja-JP" });
			worker = async (task) => {
				await captureOnPage(
					page,
					stores.get(task.store).command,
					task.product_id,
					task.product_url,
					task.filename,
				);
			};
		}
		let count = 0;
		let structureFailures = 0;
		for (const row of queue) {
			if (stopped) break;
			const task: Task = {
				store: String(row.store),
				product_id: String(row.product_id),
				product_url: String(row.product_url),
				filename: row.filename
					? String(row.filename)
					: resolve(
							dirname(dbPath),
							"metadata",
							"runs",
							id,
							`${row.store}-${row.product_id}.json`,
						),
				attempts: Number(row.attempts),
			};
			if (
				!original.refresh &&
				db
					.prepare(
						"SELECT 1 FROM latest_metadata WHERE store = ? AND product_id = ?",
					)
					.get(task.store, task.product_id)
			) {
				db.prepare(
					"UPDATE metadata_tasks SET status = 'skipped', updated_at = ? WHERE run_id = ? AND store = ? AND product_id = ?",
				).run(new Date().toISOString(), id, task.store, task.product_id);
				continue;
			}
			db.prepare(
				"UPDATE metadata_tasks SET status = 'running', filename = ?, updated_at = ? WHERE run_id = ? AND store = ? AND product_id = ?",
			).run(
				task.filename,
				new Date().toISOString(),
				id,
				task.store,
				task.product_id,
			);
			let reason: string | null = null;
			let outcome = "success";
			let missing: string[] = [];
			try {
				let saved = false;
				try {
					const data = validateMetadata(
						JSON.parse(await readFile(task.filename, "utf8")),
					);
					if (
						data.store !== task.store ||
						data.productId !== task.product_id ||
						data.source !== task.product_url
					)
						throw new Error("Wrong saved product");
					saved = true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				if (!saved) {
					for (let attempt = 0; attempt < 2; attempt++) {
						if (stopped) break;
						if (!injectedWorker) await delay(attempt ? interval * 2 : interval);
						if (stopped) break;
						db.prepare(
							"UPDATE metadata_tasks SET attempts = attempts + 1 WHERE run_id = ? AND store = ? AND product_id = ?",
						).run(id, task.store, task.product_id);
						try {
							await worker?.(task);
							saved = true;
							break;
						} catch (error) {
							if (
								!(error instanceof CaptureFailure) ||
								error.reason !== "network" ||
								attempt === 1
							)
								throw error;
						}
					}
				}
				if (!saved) break;
				const report = validateMetadata(
					JSON.parse(await readFile(task.filename, "utf8")),
				);
				if (
					report.store !== task.store ||
					report.productId !== task.product_id ||
					report.source !== task.product_url
				)
					throw new Error("Worker returned another product");
				await importMetadata(task.filename, dbPath);
				missing = report.missingFields;
				structureFailures = 0;
			} catch (error) {
				if (!(error instanceof CaptureFailure)) throw error; // Disk/DB failures stop the run; never mislabel them as site failures.
				reason = error.reason;
				outcome = ["unavailable", "age_verification"].includes(reason)
					? "unsupported"
					: "failed";
				structureFailures = reason === "structure" ? structureFailures + 1 : 0;
				if (
					["captcha", "authentication", "rate_limit", "access_denied"].includes(
						reason,
					) ||
					structureFailures >= 3
				)
					stopped = true;
			}
			db.prepare(
				"UPDATE metadata_tasks SET status = ?, reason = ?, missing_fields = ?, updated_at = ? WHERE run_id = ? AND store = ? AND product_id = ?",
			).run(
				outcome,
				reason,
				JSON.stringify(missing),
				new Date().toISOString(),
				id,
				task.store,
				task.product_id,
			);
			count++;
			console.log(
				`${count}/${queue.length}: ${task.store} ${outcome}${reason ? ` (${reason})` : ""}`,
			);
		}
		return id;
	} finally {
		try {
			if (id) {
				const runId = id;
				transaction(db, () => {
					db.prepare(
						"UPDATE metadata_tasks SET status = 'pending' WHERE run_id = ? AND status = 'running'",
					).run(runId);
					const pending = Number(
						db
							.prepare(
								"SELECT count(*) AS n FROM metadata_tasks WHERE run_id = ? AND status = 'pending'",
							)
							.get(runId)?.n,
					);
					db.prepare(
						"UPDATE metadata_runs SET status = ?, updated_at = ? WHERE id = ?",
					).run(
						pending ? "interrupted" : "completed",
						new Date().toISOString(),
						runId,
					);
				});
			}
		} finally {
			db.close();
			process.removeListener("SIGINT", stop);
			process.removeListener("SIGTERM", stop);
			await browser?.close().catch(() => {});
			await unlock();
		}
	}
}

export function batchStatus(dbPath = libraryPath) {
	return readLibrary(dbPath, (db) => {
		const books = db
			.prepare(`SELECT b.store, count(*) AS total, count(m.product_id) AS captured,
			sum(CASE WHEN m.document IS NOT NULL AND json_array_length(json_extract(m.document, '$.missingFields')) > 0 THEN 1 ELSE 0 END) AS missing
			FROM books b LEFT JOIN latest_metadata m USING(store, product_id) GROUP BY b.store`)
			.all();
		if (Number(db.prepare("PRAGMA user_version").get()?.user_version) < 5)
			return { books, runs: [], outcomes: [] };
		return {
			books,
			outcomes: db
				.prepare(`WITH outcomes AS (SELECT b.store, CASE WHEN m.product_id IS NOT NULL THEN 'success'
				WHEN t.status IN ('failed','unsupported') THEN t.status ELSE 'pending' END AS status,
				CASE WHEN m.product_id IS NULL AND t.status IN ('failed','unsupported') THEN t.reason ELSE NULL END AS reason
				FROM books b LEFT JOIN latest_metadata m USING(store, product_id)
				LEFT JOIN metadata_tasks t ON t.rowid = (SELECT t2.rowid FROM metadata_tasks t2 WHERE t2.store = b.store AND t2.product_id = b.product_id ORDER BY t2.updated_at DESC, t2.rowid DESC LIMIT 1)
				) SELECT store, status, reason, count(*) AS count FROM outcomes GROUP BY store, status, reason`)
				.all(),
			runs: db
				.prepare(`SELECT r.id, r.started_at, r.updated_at, r.status, t.status AS task_status, t.reason, count(t.product_id) AS count
				FROM metadata_runs r LEFT JOIN metadata_tasks t ON t.run_id = r.id GROUP BY r.id, t.status, t.reason ORDER BY r.started_at DESC`)
				.all(),
		};
	});
}
