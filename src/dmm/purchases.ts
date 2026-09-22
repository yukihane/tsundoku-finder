import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { readShelfDom, readVolumesDom } from "./dom.js";
import { shelfUrl } from "./identity.js";
import {
	validateLimit,
	validateSample,
	validateShelf,
	validateVolumes,
} from "./import.js";
import { restoreDmmSession, saveDmmSession } from "./session.js";

export async function readShelf(page: Page) {
	return validateShelf(await page.evaluate(readShelfDom));
}
export async function readVolumePage(page: Page) {
	return {
		capturedAt: new Date().toISOString(),
		...validateVolumes(await page.evaluate(readVolumesDom)),
	};
}

export async function collectSample(page: Page, limit = 25) {
	validateLimit(limit);
	const startedAt = new Date().toISOString();
	const shelf = await readShelf(page);
	const pages: Awaited<ReturnType<typeof readVolumePage>>[] = [];
	let count = 0;
	for (const series of shelf.series) {
		if (count >= limit) break;
		await page.waitForTimeout(1500);
		const response = await page.goto(series.url, {
			waitUntil: "domcontentloaded",
			timeout: 60000,
		});
		if (!response?.ok()) throw new Error("DMM volumes request failed");
		await page
			.locator('[data-testid="purchased-volume-book"]')
			.first()
			.waitFor({ timeout: 30000 });
		const snapshot = await readVolumePage(page);
		pages.push(snapshot);
		count += snapshot.books.length;
	}
	return validateSample({
		schemaVersion: 1,
		scope: "dmm-purchased-sample",
		store: "dmm-books",
		complete: false,
		requestedLimit: limit,
		startedAt,
		completedAt: new Date().toISOString(),
		shelf,
		pages,
	});
}

export async function capturePurchasedSample(limit = 25) {
	validateLimit(limit);
	const profile = fileURLToPath(
		new URL("../../.local/dmm/browser-profile/", import.meta.url),
	);
	await mkdir(profile, { recursive: true });
	const context = await chromium.launchPersistentContext(profile, {
		headless: false,
		locale: "ja-JP",
		viewport: { width: 1280, height: 900 },
	});
	const close = () => {
		void context.close().catch(() => {});
	};
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
	try {
		const sessionDirectory = fileURLToPath(
			new URL("../../.local/dmm/", import.meta.url),
		);
		await restoreDmmSession(context, sessionDirectory);
		const page = await context.newPage();
		console.log(
			"DMM本棚を最大5分待ちます。専用ブラウザーでログイン・追加認証を完了してください。",
		);
		await page.goto(shelfUrl, {
			waitUntil: "domcontentloaded",
			timeout: 60000,
		});
		await page
			.locator('[data-e2e="library"] > li')
			.first()
			.waitFor({ timeout: 300000 });
		const sample = await collectSample(page, limit);
		await saveDmmSession(context, sessionDirectory);
		const directory = fileURLToPath(
			new URL("../../.local/dmm/purchases/", import.meta.url),
		);
		await mkdir(directory, { recursive: true });
		const name = `${sample.completedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
		await writeFile(
			`${directory}/${name}`,
			`${JSON.stringify(sample, null, 2)}\n`,
			{ flag: "wx" },
		);
		console.log(
			`DMMの部分取得を .local/dmm/purchases/${name} に保存しました。取り込み上限は${limit}冊です。DBは更新していません。`,
		);
		return sample;
	} finally {
		process.removeListener("SIGINT", close);
		process.removeListener("SIGTERM", close);
		await context.close().catch(() => {});
	}
}
