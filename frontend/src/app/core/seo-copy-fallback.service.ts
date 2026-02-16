import { Injectable } from '@angular/core';
import { SeoLanguage } from './seo-head-links.service';

function cleanText(value: unknown, maxLen = 220): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return '';
  }
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.slice(0, maxLen).trim();
}

@Injectable({ providedIn: 'root' })
export class SeoCopyFallbackService {
  pageIntro(lang: SeoLanguage, title: string): string {
    const safeTitle = cleanText(title, 90) || (lang === 'ro' ? 'aceasta pagina' : 'this page');
    if (lang === 'ro') {
      return `Gaseste informatii esentiale despre ${safeTitle}, inclusiv detalii practice si linkuri utile pentru pasi urmatori.`;
    }
    return `Find essential information about ${safeTitle}, including practical details and useful links for next steps.`;
  }

  productIntro(lang: SeoLanguage, name: string, category?: string | null): string {
    const safeName = cleanText(name, 90) || (lang === 'ro' ? 'acest produs' : 'this product');
    const safeCategory = cleanText(category, 50);
    if (lang === 'ro') {
      if (safeCategory) {
        return `${safeName} face parte din categoria ${safeCategory} si include detalii clare despre materiale, disponibilitate si utilizare.`;
      }
      return `${safeName} include detalii clare despre materiale, disponibilitate si utilizare, pentru o alegere rapida si informata.`;
    }
    if (safeCategory) {
      return `${safeName} belongs to the ${safeCategory} category and includes clear details on materials, availability, and practical use.`;
    }
    return `${safeName} includes clear details on materials, availability, and practical use so customers can decide quickly.`;
  }

  blogListIntro(lang: SeoLanguage, contextTag?: string | null, contextSeries?: string | null): string {
    const tag = cleanText(contextTag, 50);
    const series = cleanText(contextSeries, 50);
    if (lang === 'ro') {
      if (series) return `Exploreaza articolele din seria ${series}, cu exemple practice si recomandari aplicabile imediat.`;
      if (tag) return `Exploreaza articolele etichetate ${tag}, organizate pentru cautare rapida si context clar.`;
      return 'Exploreaza articole noi, organizate pe teme, cu exemple practice si recomandari aplicabile imediat.';
    }
    if (series) return `Browse posts from the ${series} series with practical examples and actionable guidance.`;
    if (tag) return `Browse posts tagged ${tag}, organized for quick discovery and clear context.`;
    return 'Browse recent posts organized by topic with practical examples and actionable guidance.';
  }

  blogPostIntro(lang: SeoLanguage, title: string): string {
    const safeTitle = cleanText(title, 90) || (lang === 'ro' ? 'acest articol' : 'this article');
    if (lang === 'ro') {
      return `${safeTitle} rezuma punctele cheie intr-un format usor de parcurs, cu trimiteri catre pagini relevante.`;
    }
    return `${safeTitle} summarizes key points in an easy-to-scan format and links to relevant follow-up pages.`;
  }
}
