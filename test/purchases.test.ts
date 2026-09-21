import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { purchasesUrl, readPurchasePage, validatePurchaseLimit } from '../src/kindle/purchases.js';

function fixture({ filter = '購入済み', count = 2, search = '', missingDate = false, duplicate = false } = {}) {
  return `<div id="ContentCategoryDropDown"><div class="drop-down-text">本</div></div>
    <div id="ContentSubCategoryDropDown"><div class="drop-down-text">${filter}</div><span>購入済み</span></div>
    <input id="content-search-box" value="${search}">
    <div id="CONTENT_COUNT">100のうち1から${count}までの商品を表示しています</div>
    ${[1, duplicate ? 1 : 2].map(n => `<div id="content-title-B00000000${n}">架空の本 ${n}</div>
      <div id="content-author-B00000000${n}">架空の著者</div>
      ${missingDate ? '' : `<div id="content-acquired-date-B00000000${n}">取得日: 2026年9月1日</div>`}`).join('')}`;
}

test('purchased classification requires matching URL, selected filter and complete rows', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let html = fixture();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto(purchasesUrl);
    const report = await readPurchasePage(page, 1);
    assert.equal(report.books.length, 1);
    assert.equal(report.books[0]?.ownership, 'purchased');
    assert.equal(report.books[0]?.authorsText, '架空の著者');
    assert.equal(report.books[0]?.acquiredDateText, '取得日: 2026年9月1日');
    assert.equal(report.ownershipEvidence.filter, '購入済み');
    assert.equal(report.ownershipEvidence.capturedAt, report.capturedAt);
    assert.equal(report.complete, false);
    assert.deepEqual(report.observedRange, { total: 100, start: 1, end: 2 });
    for (const url of [purchasesUrl.replace('booksPurchases', 'kuAll'), purchasesUrl + '?pageNumber=2', purchasesUrl + '?search=test', 'https://www.amazon.co.jp/ap/signin']) {
      await page.goto(url);
      await assert.rejects(readPurchasePage(page, 10), /unfiltered/);
    }
    for (const options of [{ filter: 'すべて' }, { search: '検索中' }, { count: 25 }, { missingDate: true }, { duplicate: true }]) {
      html = fixture(options);
      await page.goto(purchasesUrl);
      await assert.rejects(readPurchasePage(page, 10));
    }
  } finally {
    await browser.close();
  }
});

test('purchase limit matches a single page', () => {
  for (const limit of [0, -1, 26, 1.5, NaN]) assert.throws(() => validatePurchaseLimit(limit));
  validatePurchaseLimit(1);
  validatePurchaseLimit(25);
});
