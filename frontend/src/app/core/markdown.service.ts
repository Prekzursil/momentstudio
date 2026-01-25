import { Injectable } from '@angular/core';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';

@Injectable({ providedIn: 'root' })
export class MarkdownService {
  private readonly purify = typeof window !== 'undefined' ? createDOMPurify(window) : null;

  render(markdown: string): string {
    const raw = marked.parse(markdown || '', { breaks: true }) as string;
    return this.purify ? this.purify.sanitize(raw) : raw;
  }

  renderWithSanitizationReport(markdown: string): { html: string; sanitized: boolean } {
    const raw = marked.parse(markdown || '', { breaks: true }) as string;
    if (!this.purify) return { html: raw, sanitized: false };
    const cleaned = this.purify.sanitize(raw);
    return { html: cleaned, sanitized: cleaned !== raw };
  }
}
