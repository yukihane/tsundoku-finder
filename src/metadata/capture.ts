import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { libraryPath, readLibrary } from "../library/database.js";
import { writeJson } from "../local-files.js";
import { stores } from "../stores/registry.js";
import { validateMetadata } from "./import.js";

export type FailureReason =
	| "authentication"
	| "age_verification"
	| "captcha"
	| "unavailable"
	| "rate_limit"
	| "access_denied"
	| "network"
	| "structure";
export class CaptureFailure extends Error {
	constructor(public readonly reason: FailureReason) {
		super(reason);
	}
}
export function classifyPage(
	status: number,
	url: string,
	text: string,
): FailureReason | null {
	if (status === 429) return "rate_limit";
	if (
		/captcha|ロボットではない|文字を入力して|自動アクセスを検出/i.test(text) ||
		/captcha/i.test(url)
	)
		return "captcha";
	if (
		/年齢確認|18歳以上ですか|18歳未満の方/.test(text) &&
		/はい|いいえ|成人/.test(text)
	)
		return "age_verification";
	if (
		/\/ap\/signin|\/login(?:[/?]|$)|accounts\.dmm\.com/.test(url) ||
		status === 401
	)
		return "authentication";
	if (status === 404 || status === 410) return "unavailable";
	if (status === 403) return "access_denied";
	if (status >= 500) return "network";
	return null;
}
export async function captureOnPage(
	page: Page,
	command: string,
	productId: string,
	productUrl: string,
	filename?: string,
) {
	const adapter = stores.command(command);
	if (
		!adapter.isProductId(productId) ||
		adapter.productUrl(productId, productUrl) !== productUrl
	)
		throw new Error("Invalid product identity");
	let status = 0;
	try {
		const response = await page.goto(productUrl, {
			waitUntil: "domcontentloaded",
			timeout: 60000,
		});
		status = response?.status() ?? 0;
	} catch {
		throw new CaptureFailure("network");
	}
	const gate = async () =>
		classifyPage(
			status,
			page.url(),
			(await page.locator("body").innerText({ timeout: 5000 })).slice(0, 15000),
		);
	const reason = await gate();
	if (reason) throw new CaptureFailure(reason);
	if (status < 200 || status >= 400) throw new CaptureFailure("network");
	try {
		await adapter.waitForMetadata(page);
	} catch {
		throw new CaptureFailure((await gate()) ?? "structure");
	}
	let report: ReturnType<typeof validateMetadata>;
	try {
		report = validateMetadata(await adapter.readMetadata(page, productId));
		if (
			report.store !== adapter.id ||
			report.productId !== productId ||
			report.source !== productUrl
		)
			throw new Error("Unexpected metadata identity");
	} catch {
		throw new CaptureFailure((await gate()) ?? "structure");
	}
	const destination =
		filename ??
		fileURLToPath(
			new URL(
				`../../.local/metadata/${command}/${report.capturedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`,
				import.meta.url,
			),
		);
	await writeJson(destination, report);
	return { report, filename: destination };
}
export async function captureMetadata(
	command: string,
	productId: string,
	dbPath = libraryPath,
) {
	const adapter = stores.command(command);
	const owned = readLibrary(dbPath, (db) =>
		db
			.prepare(
				"SELECT product_url FROM books WHERE store = ? AND product_id = ?",
			)
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
		const result = await captureOnPage(
			page,
			command,
			productId,
			String(owned.product_url),
		);
		console.log(
			`1件を ${result.filename} に保存しました。DBは更新していません。`,
		);
		console.log(
			`取得できなかった項目: ${result.report.missingFields.join(", ") || "なし"}`,
		);
		return result.report;
	} finally {
		process.removeListener("SIGINT", close);
		process.removeListener("SIGTERM", close);
		await browser.close().catch(() => {});
	}
}
