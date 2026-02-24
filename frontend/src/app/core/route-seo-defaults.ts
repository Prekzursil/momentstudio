import { appConfig } from './app-config';
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

function siteName(): string {
  return String(appConfig.siteName || '').trim() || 'momentstudio';
}

function fallbackDescriptions(): Record<SeoRouteKey, Record<SeoLanguage, string>> {
  const brand = siteName();
  return {
    home: {
      en: `Discover handcrafted ceramic art, featured collections, and new arrivals from ${brand}.`,
      ro: `Descopera arta ceramica lucrata manual, colectii recomandate si noutati de la ${brand}.`
    },
    shop: {
      en: 'Browse handmade products by category, compare options, and find pieces crafted for everyday use.',
      ro: 'Exploreaza produse lucrate manual pe categorii, compara optiuni si gaseste piese create pentru uz zilnic.'
    },
    blog: {
      en: `Read practical stories, guides, and studio updates from ${brand}.`,
      ro: `Citeste povesti practice, ghiduri si noutati din atelierul ${brand}.`
    },
    blog_post: {
      en: `Read this article from ${brand} for practical ideas and studio context.`,
      ro: `Citeste acest articol ${brand} pentru idei practice si context din atelier.`
    },
    page: {
      en: `Read this ${brand} page for details, policy information, and support links.`,
      ro: `Citeste aceasta pagina ${brand} pentru detalii, informatii de politica si linkuri de suport.`
    },
    product: {
      en: `View product details, materials, and availability for this handmade piece from ${brand}.`,
      ro: `Vezi detalii de produs, materiale si disponibilitate pentru aceasta piesa lucrata manual la ${brand}.`
    },
    about: {
      en: `Learn about ${brand} and the makers behind handcrafted ceramic art.`,
      ro: `Afla povestea ${brand} si a creatorilor din spatele artei ceramice lucrate manual.`
    },
    contact: {
      en: `Contact ${brand} for custom requests, order support, and collaboration questions.`,
      ro: `Contacteaza ${brand} pentru cereri personalizate, suport comenzi si colaborari.`
    }
  };
}

function normalizeCandidate(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return '';
  }
  const text = String(value).replace(/\s+/g, ' ').trim();
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
  return fallbackDescriptions()[route][lang];
}
