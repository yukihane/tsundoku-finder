export interface KindleCard {
  id: string;
  title: string;
  authorsText: string;
  badges: string[];
}

export interface KindleLibraryBook {
  asin: string;
  title: string;
  authorsText: string;
  productUrl: string;
  productUrlSource: 'derived-from-asin';
  ownership: 'unknown';
  badges: string[];
}

// A library entry is not proof of purchase. Samples are recognizable in the
// observed DOM; other entitlements remain unknown until separately verified.
export function normalizeCards(cards: KindleCard[], limit: number): KindleLibraryBook[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('limit must be an integer between 1 and 50');
  }
  const books = new Map<string, KindleLibraryBook>();
  for (const card of cards) {
    const match = /^library-item-option-([A-Z0-9]{10})$/.exec(card.id);
    const asin = match?.[1];
    if (!asin || !card.title.trim() || card.badges.some(badge => /サンプル|sample/i.test(badge))) continue;
    if (!books.has(asin)) {
      books.set(asin, {
        asin,
        title: card.title.trim(),
        authorsText: card.authorsText.trim(),
        productUrl: `https://www.amazon.co.jp/dp/${asin}`,
        productUrlSource: 'derived-from-asin',
        ownership: 'unknown',
        badges: card.badges,
      });
    }
    if (books.size >= limit) break;
  }
  return [...books.values()];
}
