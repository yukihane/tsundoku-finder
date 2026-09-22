import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { bookwalkerAdapter } from "../src/bookwalker/adapter.js";
import { range } from "../src/dmm/import.js";
import { restoreDmmSession, saveDmmSession } from "../src/dmm/session.js";
import { importOwnership, readLibrary } from "../src/library/database.js";
import { lockFile, writeJson } from "../src/local-files.js";
import { batchStatus, runBatch, type Worker } from "../src/metadata/batch.js";
import { CaptureFailure, classifyPage } from "../src/metadata/capture.js";
import {
	type Collection,
	collectionOwnership,
} from "../src/ownership-collection.js";

const stamp = "2026-09-23T00:00:00.000Z";
function bw(): Collection {
	return {
		schemaVersion: 1,
		command: "bookwalker",
		startedAt: stamp,
		updatedAt: stamp,
		complete: true,
		shelves: [],
		volumes: [],
		pages: [0, 1].map((i) => ({
			schemaVersion: 1,
			scope: "bookwalker-purchased-page",
			store: "bookwalker-jp",
			source: `https://bookwalker.jp/holdBooks/${i ? "?page=2" : ""}`,
			capturedAt: stamp,
			complete: false,
			requestedLimit: 50,
			evidence: {
				heading: "購入済み書籍一覧 (51件)",
				rangeText: `${i * 50 + 1}〜${i ? 51 : 50}件/全51件`,
				rowCount: i ? 1 : 50,
				ungrouped: true,
				searchText: "",
				filters: {
					category: "カテゴリ",
					label: "レーベル",
					publisher: "出版社",
					reading: "読書状態",
					age: "R18表示",
				},
			},
			books: Array.from({ length: i ? 1 : 50 }, (_, j) => {
				const id = `00000000-0000-4000-8000-${String(i * 50 + j + 1).padStart(12, "0")}`;
				return {
					productId: id,
					productUrl: `https://bookwalker.jp/de${id}/`,
					title: "架空書籍",
					authorsText: "架空著者",
					acquiredDateText: "2026/09/01 00:00購入",
					ownership: "purchased" as const,
				};
			}),
		})),
	};
}
function dmm(): Collection {
	const url = "https://book.dmm.com/product/100/volumes/?tab=purchased";
	return {
		schemaVersion: 1,
		command: "dmm",
		startedAt: stamp,
		updatedAt: stamp,
		complete: true,
		pages: [],
		shelves: [
			{
				source: "https://book.dmm.com/shelf/",
				heading: "本棚",
				ranges: ["1〜1件/全1件"],
				rowCount: 1,
				filters: ["全年齢 / R18すべて", "購入済みすべて"],
				selectedFilters: ["全年齢 / R18すべて", "購入済みすべて"],
				expiryFilter: "orangeBoldSquareOn",
				search: "",
				sort: "購入日が新しい順",
				series: [{ url, authorsText: "架空著者" }],
			},
		],
		volumes: [
			[1, 2].map((n) => ({
				source: `${url}${n === 2 ? "&page=2" : ""}`,
				heading: "架空シリーズ",
				capturedAt: stamp,
				selectedTabs: ["購入済み"],
				ranges: [`${n}〜${n}件/全2件`],
				rowCount: 1,
				otherRowCount: 0,
				books: [
					{
						title: "架空書籍",
						productLink: `https://book.dmm.com/product/100/test${n}/`,
						labels: ["購入済み"],
						downloadUrl: `https://book.dmm.com/download/?product_id=test${n}`,
						reviewUrl: null,
					},
				],
			})),
		],
	};
}
test("full ownership validates contiguous pages, totals, filters, duplicate IDs and both DMM levels", () => {
	assert.equal(collectionOwnership(bw()).books.length, 51);
	assert.equal(collectionOwnership(dmm()).books.length, 2);
	assert.throws(() => range(["21〜20件/全20件"], 0, 21));
	const partial = bw();
	partial.complete = false;
	partial.pages.pop();
	assert.equal(collectionOwnership(partial, false).books.length, 50);
	assert.throws(() => collectionOwnership(partial));
	for (const change of [
		(c: Collection) => {
			c.pages.reverse();
		},
		(c: Collection) => {
			c.pages[1] = c.pages[0] as Collection["pages"][number];
		},
		(c: Collection) => {
			const p = c.pages[0];
			if (p) p.evidence.filters.age = "R18のみ";
		},
		(c: Collection) => {
			const a = c.pages[0]?.books[0];
			const b = c.pages[1];
			if (a && b) b.books = [a];
		},
		(c: Collection) => {
			const p = c.pages[0];
			if (p) p.capturedAt = "2027-01-01T00:00:00.000Z";
		},
	]) {
		const c = bw();
		change(c);
		assert.throws(() => collectionOwnership(c));
	}
	const c = dmm();
	c.volumes[0]?.reverse();
	assert.throws(() => collectionOwnership(c));
});

async function database() {
	const path = join(
		await mkdtemp(join(tmpdir(), "tsundoku-batch-")),
		"library.sqlite",
	);
	await importOwnership(collectionOwnership(dmm()), path);
	return path;
}
const success: Worker = async (task) => {
	await writeJson(task.filename, {
		schemaVersion: 1,
		scope: "dmm-metadata-sample",
		store: task.store,
		productId: task.product_id,
		source: task.product_url,
		capturedAt: new Date().toISOString(),
		title: "架空書籍",
		authorsText: "架空著者",
		publisher: null,
		description: "検索できる紹介文",
		categories: [],
		series: null,
		publicationDateText: null,
		label: null,
		genres: [],
		distributionDateText: null,
		missingFields: ["publisher", "categories", "series"],
	});
};
test("batch persists a limited queue, resumes, skips successes and retains metadata on refresh failure", async () => {
	const db = await database();
	const before = readLibrary(db, (d) => d.prepare("SELECT * FROM books").all());
	let calls = 0;
	const worker: Worker = async (t) => {
		calls++;
		await success(t);
	};
	const id = await runBatch({ store: "dmm", limit: 1 }, db, worker);
	assert.equal(calls, 1);
	assert.equal(batchStatus(db).books[0]?.captured, 1);
	await runBatch({ resume: id, limit: 10 }, db, worker);
	assert.equal(calls, 2);
	await runBatch({ store: "dmm" }, db, worker);
	assert.equal(calls, 2);
	await runBatch({ store: "dmm", refresh: true }, db, async () => {
		throw new CaptureFailure("unavailable");
	});
	assert.equal(batchStatus(db).books[0]?.captured, 2);
	assert.deepEqual(
		readLibrary(db, (d) => d.prepare("SELECT * FROM books").all()),
		before,
	);
	assert.equal(
		readLibrary(
			db,
			(d) => d.prepare("PRAGMA integrity_check").get()?.integrity_check,
		),
		"ok",
	);
});
test("batch bounds network retries, stops on captcha, supports explicit retry and recovers saved results", async () => {
	const db = await database();
	let calls = 0;
	const id = await runBatch({ store: "dmm" }, db, async () => {
		calls++;
		throw new CaptureFailure("captcha");
	});
	assert.equal(calls, 1);
	await runBatch({ resume: id }, db, success);
	await runBatch({ store: "dmm" }, db, async () => {
		assert.fail("failure needs explicit retry");
	});
	await runBatch({ store: "dmm", retry: true }, db, async () => {
		calls++;
		throw new CaptureFailure("network");
	});
	assert.equal(calls, 3);
	await assert.rejects(
		runBatch({ store: "dmm", retry: true }, db, async (task) => {
			await success(task);
			throw new Error("simulated interruption after saving JSON");
		}),
	);
	const run = readLibrary(db, (d) =>
		d
			.prepare(
				"SELECT id FROM metadata_runs WHERE status = 'interrupted' ORDER BY started_at DESC LIMIT 1",
			)
			.get(),
	);
	assert.ok(run);
	await runBatch({ resume: String(run.id) }, db, async () => {
		assert.fail("must reuse saved JSON");
	});
	assert.equal(batchStatus(db).books[0]?.captured, 2);
	const bytes = await readFile(db);
	await assert.rejects(runBatch({ resume: "unknown" }, db, success));
	assert.deepEqual(await readFile(db), bytes);
});
test("page gates distinguish access restrictions without treating a generic 404 as proven sale end", () => {
	assert.equal(classifyPage(404, "https://example.com/", ""), "unavailable");
	assert.equal(
		classifyPage(200, "https://example.com/login/", ""),
		"authentication",
	);
	assert.equal(
		classifyPage(
			200,
			"https://example.com/",
			"年齢確認 18歳以上ですか はい いいえ",
		),
		"age_verification",
	);
	assert.equal(classifyPage(200, "https://example.com/", "captcha"), "captcha");
	assert.equal(classifyPage(503, "https://example.com/", ""), "network");
});

test("adult BOOKWALKER URLs retain the same UUID without accepting lookalike hosts", () => {
	const c = bw();
	const book = c.pages[1]?.books[0];
	assert.ok(book);
	book.productUrl = book.productUrl.replace(
		"bookwalker.jp",
		"r18.bookwalker.jp",
	);
	const input = collectionOwnership(c);
	assert.equal(input.books.at(-1)?.productUrl, book.productUrl);
	assert.equal(
		bookwalkerAdapter.productUrl(book.productId, book.productUrl),
		book.productUrl,
	);
	assert.throws(() =>
		bookwalkerAdapter.productUrl(
			book.productId,
			book.productUrl.replace("r18.", "fake."),
		),
	);
});

test("local session snapshot restores session cookies after the browser closes and locks exclude concurrent writers", async () => {
	const dir = await mkdtemp(join(tmpdir(), "tsundoku-session-"));
	const browser = await chromium.launch();
	try {
		const first = await browser.newContext();
		await first.addCookies([
			{
				name: "fictional-session",
				value: "fixture-only",
				domain: "example.com",
				path: "/",
				httpOnly: true,
				secure: true,
				sameSite: "Lax",
			},
		]);
		await saveDmmSession(first, dir);
		await first.close();
		const second = await browser.newContext();
		assert.equal((await second.cookies()).length, 0);
		await restoreDmmSession(second, dir);
		assert.equal((await second.cookies())[0]?.value, "fixture-only");
		assert.equal((await second.cookies())[0]?.expires, -1);
		await second.close();
	} finally {
		await browser.close();
	}
	const path = join(dir, "writer.lock");
	const release = await lockFile(path);
	await assert.rejects(lockFile(path));
	await release();
	await (await lockFile(path))();
});
