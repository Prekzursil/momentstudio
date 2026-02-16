import { SeoLanguage } from './seo-head-links.service';

export type SeoRouteKey =
  | 'home'
  | 'shop'
  | 'blog'
  | 'blog_post'
  | 'page'
  | 'product'
  | 'about'
  | 'contact';

const FALLBACK_DESCRIPTIONS: Record<SeoRouteKey, Record<SeoLanguage, string>> = {
  home: {
    en: 'Discover handcrafted ceramic art, featured collections, and new arrivals from momentstudio.',
    ro: 'Descopera arta ceramica lucrata manual, colectii recomandate si noutati de la momentstudio.'
  },
  shop: {
    en: 'Browse handmade products by category, compare options, and find pieces crafted for everyday use.',
    ro: 'Exploreaza produse lucrate manual pe categorii, compara optiuni si gaseste piese create pentru uz zilnic.'
  },
  blog: {
    en: 'Read practical stories, guides, and studio updates from momentstudio.',
    ro: 'Citeste povesti practice, ghiduri si noutati din atelierul momentstudio.'
  },
  blog_post: {
    en: 'Read this article from momentstudio for practical ideas and studio context.',
    ro: 'Citeste acest articol momentstudio pentru idei practice si context din atelier.'
  },
  page: {
    en: 'Read this momentstudio page for details, policy information, and support links.',
    ro: 'Citeste aceasta pagina momentstudio pentru detalii, informatii de politica si linkuri de suport.'
  },
  product: {
    en: 'View product details, materials, and availability for this handmade piece from momentstudio.',
    ro: 'Vezi detalii de produs, materiale si disponibilitate pentru aceasta piesa lucrata manual la momentstudio.'
  },
  about: {
    en: 'Learn about momentstudio and the makers behind handcrafted ceramic art.',
    ro: 'Afla povestea momentstudio si a creatorilor din spatele artei ceramice lucrate manual.'
  },
  contact: {
    en: 'Contact momentstudio for custom requests, order support, and collaboration questions.',
    ro: 'Contacteaza momentstudio pentru cereri personalizate, suport comenzi si colaborari.'
  }
};

function normalizeCandidate(value: unknown): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // Ignore unresolved translation keys returned by instant().
  if (/^[a-z0-9_.-]+$/i.test(text) && text.includes('.')) return '';
  return text;
}

export function resolveRouteSeoDescription(route: SeoRouteKey, lang: SeoLanguage, ...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    if (normalized) return normalized;
  }
  return FALLBACK_DESCRIPTIONS[route][lang];
}

