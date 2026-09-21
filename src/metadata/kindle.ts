import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { getBook } from "../library/queries.js";

export async function readKindleMetadata(page: Page, asin: string) {
	if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error("Invalid ASIN");
	const snapshot = await page.evaluate(() => ({
		url: location.href,
		texts: [
			"#centerCol #productTitle",
			"#centerCol #bylineInfo",
			"#centerCol #bookDescription_feature_div .a-expander-content",
		].map((selector) => {
			const elements = document.querySelectorAll(selector);
			return elements.length === 1 ? elements[0]?.textContent : null;
		}),
		fields: Array.from(
			document.querySelectorAll("#detailBulletsWrapper_feature_div li"),
		).map((el) => el.textContent),
		categories: Array.from(
			document.querySelectorAll("#wayfinding-breadcrumbs_feature_div a"),
		).map((el) => el.textContent),
		series: Array.from(
			document.querySelectorAll("#seriesBulletWidget_feature_div a"),
		).map((el) => ({
			text: el.textContent,
			url: (el as HTMLAnchorElement).href,
		})),
	}));
	const clean = (value: string | null | undefined) =>
		value
			?.replace(/[\u200e\u200f]/g, "")
			.replace(/\s+/g, " ")
			.trim() || null;
	const fields = snapshot.fields
		.map(clean)
		.filter((value): value is string => value !== null);
	const field = (name: string) => {
		const values = fields.filter((value) => value.startsWith(`${name} :`));
		return values.length === 1
			? values[0]?.slice(name.length + 2).trim() || null
			: null;
	};
	const candidate = snapshot.series.length === 1 ? snapshot.series[0] : null;
	const data = {
		url: snapshot.url,
		asin: field("ASIN"),
		title: clean(snapshot.texts[0]),
		authorsText: clean(snapshot.texts[1]),
		description: clean(snapshot.texts[2]),
		publisher: field("出版社"),
		publicationDateText: field("発売日"),
		categories: snapshot.categories
			.map(clean)
			.filter((value): value is string => value !== null),
		series: candidate
			? { text: clean(candidate.text), url: candidate.url }
			: null,
	};
	const url = new URL(data.url);
	if (
		url.origin !== "https://www.amazon.co.jp" ||
		!url.pathname.endsWith(`/dp/${asin}`) ||
		data.asin !== asin ||
		!data.title ||
		!/形式\s*:\s*Kindle版/.test(data.authorsText ?? "")
	)
		throw new Error("Product identity or Kindle format could not be verified");
	const seriesUrl = data.series ? new URL(data.series.url) : null;
	const series =
		seriesUrl?.origin === url.origin &&
		/^\/dp\/[A-Z0-9]{10}$/.test(seriesUrl.pathname) &&
		data.series?.text
			? { text: data.series.text, url: seriesUrl.origin + seriesUrl.pathname }
			: null;
	return {
		schemaVersion: 1,
		scope: "kindle-metadata-sample",
		source: `https://www.amazon.co.jp/dp/${asin}`,
		capturedAt: new Date().toISOString(),
		store: "kindle-jp",
		productId: asin,
		title: data.title,
		authorsText: data.authorsText,
		publisher: data.publisher,
		publicationDateText: data.publicationDateText,
		description: data.description,
		categories: data.categories,
		series,
		missingFields: [
			!data.publisher && "publisher",
			!data.description && "description",
			!data.categories.length && "categories",
			!series && "series",
		].filter((value): value is string => Boolean(value)),
	};
}

export async function captureKindleMetadata(asin: string) {
	if (!getBook(asin)) throw new Error("Book is not in the owned library");
	const browser = await chromium.launch({ headless: false });
	const close = () => {
		void browser.close().catch(() => {});
	};
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
	try {
		const page = await browser.newPage({ locale: "ja-JP" });
		const response = await page.goto(`https://www.amazon.co.jp/dp/${asin}`, {
			waitUntil: "domcontentloaded",
			timeout: 60000,
		});
		if (!response?.ok()) throw new Error("Product request failed");
		await page
			.locator("#detailBulletsWrapper_feature_div")
			.waitFor({ timeout: 30000 });
		const report = await readKindleMetadata(page, asin);
		const directory = fileURLToPath(
			new URL("../../.local/metadata/kindle/", import.meta.url),
		);
		await mkdir(directory, { recursive: true });
		const filename = `${report.capturedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`;
		await writeFile(
			`${directory}/${filename}`,
			`${JSON.stringify(report, null, 2)}\n`,
			{ flag: "wx" },
		);
		console.log(
			`1件を .local/metadata/kindle/${filename} に保存しました。DBは更新していません。`,
		);
		console.log(
			`取得できなかった項目: ${report.missingFields.join(", ") || "なし"}`,
		);
	} finally {
		process.removeListener("SIGINT", close);
		process.removeListener("SIGTERM", close);
		await browser.close();
	}
}
