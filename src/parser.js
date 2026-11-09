import { load } from 'cheerio';
import { SearchError } from './search.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The selectors refer to actual search-result cards in fixtures/iphone.html.
// The similar cards in the autocomplete panel have no data-test=product-card.
export function parseSearchHtml(html, { query, page = 1 } = {}) {
  if (typeof html !== 'string' || !html.trim()) throw new SearchError('PARSING_ERROR', 'HTML vacío o inválido.');
  const $ = load(html);
  const heading = $('h1').first().text().trim();
  const match = /^Your search:\s*(.+)$/i.exec(heading);
  if (!match) throw new SearchError('PARSING_ERROR', 'No se reconoce el encabezado de resultados de búsqueda.');
  if (typeof query !== 'string' || match[1].trim().toLocaleLowerCase('en-US') !== query.trim().toLocaleLowerCase('en-US')) throw new SearchError('QUERY_MISMATCH', 'La consulta no coincide con el HTML guardado.');
  // This captured page provides no reliable saved pagination metadata.
  if (page !== 1) throw new SearchError('PAGE_UNVERIFIED', 'No se puede verificar la página solicitada en el HTML guardado.');
  const cards = $('[data-test="product-card"][data-qa="productCard"]');
  if (!cards.length) throw new SearchError('COMMERCIAL_DATA_NOT_FOUND', 'No se encontraron tarjetas de resultados; no se puede confirmar una búsqueda vacía.');
  const results = [];
  cards.each((_, element) => {
    const card = $(element);
    const titleElement = card.find('[data-test="product-title"]').first();
    const title = titleElement.text().trim();
    const link = titleElement.closest('a').attr('href');
    if (!title || !link) throw new SearchError('PARSING_ERROR', 'Tarjeta sin título o enlace verificable.');
    const priceText = card.find('[data-qa="productCardPrice"] .heading-2').first().text().replace(/\s/g, '');
    const priceMatch = /^\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)$/.exec(priceText);
    const price = priceMatch ? Number(priceMatch[1].replaceAll(',', '')) : null;
    const imageSrc = card.find('[data-test="product-card-image"]').first().attr('src');
    let image = null;
    if (imageSrc) {
      try { const candidate = new URL(imageSrc, 'https://www.backmarket.com'); if (candidate.protocol === 'https:') image = candidate.href; } catch { /* missing image */ }
    }
    const id = card.attr('id');
    results.push({ title, url: link, price, currency: priceMatch && $('html').attr('lang')?.toLowerCase() === 'en-us' ? 'USD' : null,
      image, productId: uuid.test(id || '') ? id : null, category: card.attr('category')?.trim() || null, condition: null,
      priceType: price !== null && card.find('[data-test="product-starting-from"]').length ? 'starting_at' : null });
  });
  return { results };
}
