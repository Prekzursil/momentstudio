import { Injectable, SecurityContext, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';

@Injectable({ providedIn: 'root' })
export class MarkdownService {
  private readonly sanitizer = inject(DomSanitizer);

  render(markdown: string): string {
    const raw = marked.parse(markdown || '', { breaks: true }) as string;
    return this.sanitize(raw);
  }

  renderWithSanitizationReport(markdown: string): { html: string; sanitized: boolean } {
    const raw = marked.parse(markdown || '', { breaks: true }) as string;
    const cleaned = this.sanitize(raw);
    return { html: cleaned, sanitized: cleaned !== raw };
  }

  private sanitize(value: string): string {
    return this.sanitizer.sanitize(SecurityContext.HTML, value) || '';
  }
}
