// These read-only functions run in the page. Keep them self-contained for Playwright.
export function readShelfDom() {
	const main = document.querySelector("#root main");
	const root = document.querySelector("#root");
	const rows = Array.from(
		main?.querySelectorAll('[data-e2e="library"] > li') ?? [],
	);
	return {
		source: location.href,
		heading: main?.querySelector("h1")?.textContent?.trim(),
		ranges: Array.from(main?.querySelectorAll("p") ?? [])
			.map((e) => e.textContent?.trim())
			.filter((t) => t && /^\d[\d,]*\s*[〜～~]/.test(t)),
		filters: Array.from(
			root?.querySelectorAll('[data-testid="filter-label"]') ?? [],
		).map((e) => e.textContent?.trim()),
		selectedFilters: Array.from(
			root?.querySelectorAll('[data-is-selected="true"]') ?? [],
		).map((e) => e.textContent?.trim()),
		expiryFilter: root
			?.querySelector('[data-testid="icon-checkbox"]')
			?.getAttribute("data-name"),
		search: root?.querySelector<HTMLInputElement>(
			'input[placeholder="作品名、作家名及び出演者名などで検索できます"]',
		)?.value,
		sort: root
			?.querySelector('[data-testid="sort-button"] [data-active="true"]')
			?.textContent?.trim(),
		rowCount: rows.length,
		series: rows.map((row) => ({
			url: row.querySelector<HTMLAnchorElement>('a[href*="/volumes/"]')?.href,
			authorsText:
				row
					.querySelector('[data-testid="library-book-authors"]')
					?.textContent?.trim() ?? "",
		})),
	};
}

export function readVolumesDom() {
	const main = document.querySelector("main");
	const rows = Array.from(
		main?.querySelectorAll('[data-testid="purchased-volume-book"]') ?? [],
	);
	return {
		source: location.href,
		heading: main
			?.querySelector('[data-testid="series-title-header"]')
			?.textContent?.trim(),
		selectedTabs: Array.from(
			main?.querySelectorAll(
				'[data-testid="volume-general-tab-list"] [data-testid="tab-header-item"][data-active="true"]',
			) ?? [],
		).map((e) => e.textContent?.trim()),
		ranges: Array.from(main?.querySelectorAll("p") ?? [])
			.map((e) => e.textContent?.trim())
			.filter((t) => t && /^\d[\d,]*\s*[〜～~]/.test(t)),
		rowCount: rows.length,
		otherRowCount:
			main?.querySelectorAll(
				'[data-testid$="volume-book"]:not([data-testid="purchased-volume-book"])',
			).length ?? 0,
		books: rows.map((row) => ({
			title: row.querySelector("a[data-is-limited]")?.textContent?.trim(),
			productLink:
				row.querySelector<HTMLAnchorElement>("a[data-is-limited]")?.href,
			labels: Array.from(row.querySelectorAll("span[data-outlined]")).map((e) =>
				e.textContent?.trim(),
			),
			// Never follow these links; only read the stable ID, never the reader URL.
			downloadUrl: Array.from(
				row.querySelectorAll<HTMLAnchorElement>("a"),
			).find((a) => a.textContent?.trim() === "作品をダウンロードする")?.href,
			reviewUrl:
				Array.from(row.querySelectorAll<HTMLAnchorElement>("a")).find(
					(a) => a.textContent?.trim() === "レビューを書く",
				)?.href ?? null,
		})),
	};
}

export function readMetadataDom() {
	const main = document.querySelector("main");
	const titles = main?.querySelectorAll("h1");
	const detailLinks = main?.querySelectorAll(
		'[data-testid="volume-detail-info"]',
	);
	const details =
		detailLinks?.length === 1
			? detailLinks[0]?.closest("dl")?.parentElement
			: null;
	const descriptions = main?.querySelectorAll(
		'[data-testid="detail-book"] [data-testid="description-text"]',
	);
	return {
		url: location.href,
		canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
			?.href,
		title:
			titles?.length === 1
				? titles[0]?.textContent?.replace(/\s+/g, " ").trim() || null
				: null,
		detailCount: detailLinks?.length ?? 0,
		description:
			descriptions?.length === 1
				? descriptions[0]?.textContent?.replace(/\s+/g, " ").trim() || null
				: null,
		fields: Array.from(details?.querySelectorAll(":scope > dl") ?? []).map(
			(dl) => ({
				name:
					dl.querySelector("dt")?.textContent?.replace(/\s+/g, " ").trim() ||
					null,
				text:
					dl.querySelector("dd")?.textContent?.replace(/\s+/g, " ").trim() ||
					null,
				links: Array.from(dl.querySelectorAll<HTMLAnchorElement>("dd a")).map(
					(a) => ({
						text: a.textContent?.replace(/\s+/g, " ").trim() || null,
						url: a.href,
					}),
				),
			}),
		),
	};
}
