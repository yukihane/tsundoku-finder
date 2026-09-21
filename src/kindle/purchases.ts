import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { kindleProfilePath } from './browser.js';

export const purchasesUrl = 'https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksPurchases/dateDsc';

export function validatePurchaseLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error('limit must be 1–25');
}

export async function readPurchasePage(page: Page, limit: number) {
  validatePurchaseLimit(limit);
  // Read the URL, selected controls and rows together, without async DOM reads
  // that could accidentally combine two different page states.
  const snapshot = await page.evaluate(() => ({
    url: location.href,
    category: document.querySelector('#ContentCategoryDropDown .drop-down-text')?.textContent?.trim(),
    filter: document.querySelector('#ContentSubCategoryDropDown .drop-down-text')?.textContent?.trim(),
    search: (document.querySelector('#content-search-box') as HTMLInputElement | null)?.value,
    count: document.querySelector('#CONTENT_COUNT')?.textContent ?? '',
    rows: Array.from(document.querySelectorAll('[id^="content-title-"]')).map(element => {
      const asin = element.id.slice('content-title-'.length);
      return {
        asin, title: element.textContent?.trim() ?? '',
        authorsText: document.getElementById(`content-author-${asin}`)?.textContent?.trim() ?? '',
        acquiredDateText: document.getElementById(`content-acquired-date-${asin}`)?.textContent?.trim() ?? '',
      };
    }),
  }));
  const url = new URL(snapshot.url);
  if (url.origin + url.pathname.replace(/\/$/, '') !== purchasesUrl ||
      [...url.searchParams].some(([key, value]) => key !== 'pageNumber' || value !== '1') ||
      snapshot.category !== '本' || snapshot.filter !== '購入済み' || snapshot.search !== '') {
    throw new Error('Not an unfiltered first purchased-books page');
  }
  const range = /([\d,]+)のうち([\d,]+)から([\d,]+)までの商品を表示しています/.exec(snapshot.count);
  const [total, start, end] = range ? range.slice(1).map(v => Number(v.replaceAll(',', ''))) : [];
  if (!total || start !== 1 || !end || end > total || end > 25 || snapshot.rows.length !== end ||
      new Set(snapshot.rows.map(row => row.asin)).size !== end ||
      snapshot.rows.some(row => !/^[A-Z0-9]{10}$/.test(row.asin) || !row.title || !row.acquiredDateText)) {
    throw new Error('Purchased page is incomplete or its structure has changed');
  }
  const capturedAt = new Date().toISOString();
  return {
    schemaVersion: 1, source: purchasesUrl, capturedAt,
    scope: 'purchased-first-page-sample', complete: false, requestedLimit: limit,
    observedRange: { total, start, end },
    ownershipEvidence: { kind: 'amazon-content-filter', category: '本', filter: '購入済み', source: purchasesUrl, capturedAt },
    books: snapshot.rows.slice(0, limit).map(row => ({
      ...row, ownership: 'purchased',
      productUrl: `https://www.amazon.co.jp/dp/${row.asin}`, productUrlSource: 'derived-from-asin',
    })),
  };
}

export async function capturePurchasedSample(limit: number): Promise<void> {
  validatePurchaseLimit(limit);
  await mkdir(kindleProfilePath, { recursive: true });
  const context = await chromium.launchPersistentContext(kindleProfilePath, {
    headless: false, locale: 'ja-JP', viewport: { width: 1280, height: 900 },
  });
  const closeOnSignal = (): void => { void context.close().catch(() => {}); };
  process.once('SIGINT', closeOnSignal);
  process.once('SIGTERM', closeOnSignal);
  try {
    const page = await context.newPage();
    await page.goto(purchasesUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    console.log('購入済み一覧の表示を最大5分待ちます。ログイン画面が出た場合は手動で認証してください。');
    await page.locator('#CONTENT_ACTION_BAR').waitFor({ timeout: 300_000 });
    // Start a new document at the purchased URL after login, avoiding rows left
    // over from a client-side filter transition or a restored profile tab.
    await page.goto(purchasesUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => {
      const text = document.querySelector('#CONTENT_COUNT')?.textContent ?? '';
      const match = /のうち1から(\d+)までの商品を表示しています/.exec(text);
      return match && document.querySelectorAll('[id^="content-title-"]').length === Number(match[1]);
    }, undefined, { timeout: 30_000 });
    const report = await readPurchasePage(page, limit);
    const directory = fileURLToPath(new URL('../../.local/kindle/purchases/', import.meta.url));
    await mkdir(directory, { recursive: true });
    const filename = `${report.capturedAt.replace(/[:.]/g, '-')}-${randomUUID()}.json`;
    await writeFile(`${directory}/${filename}`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(`${report.books.length}件を .local/kindle/purchases/${filename} に保存しました。`);
    console.log('Amazonの購入済み分類を根拠とします。有料購入の確認・全件取得は行っていません。');
  } finally {
    process.removeListener('SIGINT', closeOnSignal);
    process.removeListener('SIGTERM', closeOnSignal);
    await context.close().catch(() => {});
  }
}
