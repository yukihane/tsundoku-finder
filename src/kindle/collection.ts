export interface PurchasePage {
	source: string;
	capturedAt: string;
	observedRange: { total: number; start: number; end: number };
	books: { asin: string }[];
}

export interface CollectionReport {
	schemaVersion: 1;
	scope: "purchased-library";
	startedAt: string;
	updatedAt: string;
	complete: boolean;
	status: "running" | "completed" | "page-limit" | "failed" | "interrupted";
	expectedTotal: number | null;
	collectedCount: number;
	pages: {
		pageNumber: number;
		source: string;
		capturedAt: string;
		start: number;
		end: number;
		file: string;
	}[];
	failure: { pageNumber: number; code: string } | null;
}

export function validateMaxPages(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > 1000)
		throw new Error("max-pages must be 1–1000");
}

// Persist each validated page before acknowledging it in the manifest. Never
// infer completeness from a timeout or a missing next-page control.
export async function collectPurchasePages<T extends PurchasePage>(options: {
	maxPages: number;
	load: (pageNumber: number) => Promise<T>;
	savePage: (pageNumber: number, page: T) => Promise<string>;
	saveReport: (report: CollectionReport) => Promise<void>;
	pause: () => Promise<void>;
	signal: AbortSignal;
	progress?: (report: CollectionReport) => void;
}): Promise<CollectionReport> {
	validateMaxPages(options.maxPages);
	const now = new Date().toISOString();
	const report: CollectionReport = {
		schemaVersion: 1,
		scope: "purchased-library",
		startedAt: now,
		updatedAt: now,
		complete: false,
		status: "running",
		expectedTotal: null,
		collectedCount: 0,
		pages: [],
		failure: null,
	};
	await options.saveReport(report);
	const seen = new Set<string>();
	let pageNumber = 1;
	let phase = "load";
	try {
		for (; pageNumber <= options.maxPages; pageNumber++) {
			phase = "load";
			options.signal.throwIfAborted();
			const page = await options.load(pageNumber);
			options.signal.throwIfAborted();
			phase = "inconsistent-page";
			const { total, start, end } = page.observedRange;
			if (
				!Number.isSafeInteger(total) ||
				total < 1 ||
				(report.expectedTotal !== null && total !== report.expectedTotal) ||
				start !== report.collectedCount + 1 ||
				end !== Math.min(start + 24, total) ||
				page.books.length !== end - start + 1 ||
				new Set(page.books.map((book) => book.asin)).size !==
					page.books.length ||
				page.books.some((book) => seen.has(book.asin))
			) {
				throw new Error("Inconsistent range, total or duplicate identifier");
			}
			phase = "save-page";
			const file = await options.savePage(pageNumber, page);
			for (const book of page.books) seen.add(book.asin);
			report.expectedTotal = total;
			report.collectedCount = seen.size;
			report.pages.push({
				pageNumber,
				source: page.source,
				capturedAt: page.capturedAt,
				start,
				end,
				file,
			});
			const finished = end === total && seen.size === total;
			report.status = finished
				? "completed"
				: pageNumber === options.maxPages
					? "page-limit"
					: "running";
			report.complete = finished;
			report.updatedAt = new Date().toISOString();
			phase = "save-report";
			await options.saveReport(report);
			options.progress?.(report);
			if (report.status !== "running") return report;
			phase = "pause";
			await options.pause();
		}
	} catch {
		report.complete = false;
		report.status = options.signal.aborted ? "interrupted" : "failed";
		report.failure = { pageNumber, code: phase };
		report.updatedAt = new Date().toISOString();
		// Propagate storage errors if even the failure manifest cannot be saved.
		await options.saveReport(report);
	}
	return report;
}
