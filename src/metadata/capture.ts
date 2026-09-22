import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { libraryPath, readLibrary } from "../library/database.js";
import { stores } from "../stores/registry.js";
import { validateMetadata } from "./import.js";

export async function captureMetadata(
	command: string,
	productId: string,
	dbPath = libraryPath,
) {
	const adapter = stores.command(command);
	if (!adapter.isProductId(productId)) throw new Error("Invalid product ID");
	const owned = readLibrary(dbPath, (db) =>
		db
			.prepare("SELECT 1 FROM books WHERE store = ? AND product_id = ?")
			.get(adapter.id, productId),
	);
	if (!owned) throw new Error("Book is not in the owned library");
	const browser = await chromium.launch({ headless: false });
	const close = () => {
		void browser.close().catch(() => {});
	};
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
	try {
		const page = await browser.newPage({ locale: "ja-JP" });
		const response = await page.goto(adapter.productUrl(productId), {
			waitUntil: "domcontentloaded",
			timeout: 60000,
		});
		if (!response?.ok()) throw new Error("Product request failed");
		await adapter.waitForMetadata(page);
		const report = validateMetadata(
			await adapter.readMetadata(page, productId),
		);
		if (report.store !== adapter.id || report.productId !== productId)
			throw new Error("Unexpected metadata identity");
		const directory = fileURLToPath(
			new URL(`../../.local/metadata/${adapter.command}/`, import.meta.url),
		);
		await mkdir(directory, { recursive: true });
		const filename = `${report.capturedAt?.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
		await writeFile(
			`${directory}/${filename}`,
			`${JSON.stringify(report, null, 2)}\n`,
			{ flag: "wx" },
		);
		console.log(
			`1件を .local/metadata/${adapter.command}/${filename} に保存しました。DBは更新していません。`,
		);
		console.log(
			`取得できなかった項目: ${report.missingFields.join(", ") || "なし"}`,
		);
		return report;
	} finally {
		process.removeListener("SIGINT", close);
		process.removeListener("SIGTERM", close);
		await browser.close().catch(() => {});
	}
}
