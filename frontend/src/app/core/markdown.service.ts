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
}

