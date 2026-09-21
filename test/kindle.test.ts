import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { normalizeCards } from '../src/kindle/extract.js';
import { readLibraryCards } from '../src/kindle/sample.js';

test('extracts observed card structure, excludes samples and does not infer purchase', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // All content is fictional; no Amazon requests or real account data.
    await page.route('**/*', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<input id="search-bar" value=""><ul id="cover">
        <li id="library-item-option-B000000001"><div id="title-B000000001">架空の本 第一巻</div><div id="author-B000000001">架空の著者; 別の著者</div></li>
        <li id="library-item-option-sample-main-B000000002"><div id="title-B000000002">架空のサンプル</div><canvas id="canvasBadge-B000000002" aria-label="サンプル"></canvas></li>
        <li id="library-item-option-B000000003"><div id="title-B000000003">架空の利用可能作品</div><div id="plansBadge-B000000003" aria-label="Kindle Unlimited"></div></li>
        <li></li>
      </ul>`,
    }));
    await page.goto('https://read.amazon.co.jp/kindle-library');
    const cards = await readLibraryCards(page);
    assert.equal(cards.length, 3);
    const books = normalizeCards([...cards, ...cards], 10);
    assert.equal(books.length, 2);
    assert.equal(books[0]?.authorsText, '架空の著者; 別の著者');
    assert.equal(books[0]?.productUrl, 'https://www.amazon.co.jp/dp/B000000001');
    assert.ok(books.every(book => book.ownership === 'unknown'));
    assert.deepEqual(books[1]?.badges, ['Kindle Unlimited']);
    assert.equal(normalizeCards(cards, 1).length, 1);

    await page.locator('#search-bar').fill('絞り込み');
    await assert.rejects(readLibraryCards(page), /Clear the library search/);
    await page.goto('https://www.amazon.co.jp/ap/signin');
    await assert.rejects(readLibraryCards(page), /library is not open/);
  } finally {
    await browser.close();
  }
});

test('rejects invalid identifiers, missing titles and invalid limits', () => {
  assert.deepEqual(normalizeCards([
    { id: 'library-item-option-bad', title: '本', authorsText: '', badges: [] },
    { id: 'library-item-option-B000000001', title: ' ', authorsText: '', badges: [] },
    { id: 'library-item-option-B000000002', title: '本', authorsText: '', badges: ['サンプル'] },
  ], 10), []);
  for (const limit of [0, -1, 51, 1.5, NaN]) {
    assert.throws(() => normalizeCards([], limit), /limit/);
  }
});
