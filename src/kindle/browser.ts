import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const kindleLibraryUrl = 'https://read.amazon.co.jp/kindle-library';

// Resolve from the module so changing the working directory does not select a
// different profile. src/ and dist/ have the same depth below the project root.
export const kindleProfilePath = fileURLToPath(
  new URL('../../.local/kindle/browser-profile/', import.meta.url),
);

export async function openKindleBrowser(): Promise<void> {
  await mkdir(kindleProfilePath, { recursive: true });
  const context = await chromium.launchPersistentContext(kindleProfilePath, {
    headless: false,
    locale: 'ja-JP',
    viewport: { width: 1280, height: 900 },
  });
  const closed = new Promise<void>((resolve) => context.once('close', () => resolve()));
  const closeOnSignal = (): void => { void context.close().catch(() => {}); };
  process.once('SIGINT', closeOnSignal);
  process.once('SIGTERM', closeOnSignal);
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(kindleLibraryUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    console.log('専用ブラウザでAmazon.co.jpにログインしてください。追加認証もブラウザで行ってください。');
    console.log('確認が終わったらブラウザのウィンドウを閉じてください。');
    console.log('認証状態は .local/kindle/browser-profile/ に保存されます。通常のChromeプロファイルとは別です。');
    await closed;
    console.log('ブラウザを終了しました。ログイン成否や所有書籍の取得はまだ自動判定していません。');
  } finally {
    process.removeListener('SIGINT', closeOnSignal);
    process.removeListener('SIGTERM', closeOnSignal);
    await context.close().catch(() => {});
  }
}
