import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class StructuredDataService {
  private readonly document = inject(DOCUMENT);
  private readonly managedSelector = 'script[type="application/ld+json"][data-seo-route-schema="true"]';
  private readonly idPrefix = 'seo-route-schema-';

  setRouteSchemas(schemas: ReadonlyArray<Record<string, unknown>>): void {
    const cleaned = schemas.filter((item) => item && typeof item === 'object');
    const expectedIds = new Set<string>();

    cleaned.forEach((schema, index) => {
      const id = `${this.idPrefix}${index + 1}`;
      expectedIds.add(id);
      const script = this.upsertScript(id);
      script.text = JSON.stringify(schema);
    });

    this.document.querySelectorAll<HTMLScriptElement>(this.managedSelector).forEach((node) => {
      if (!expectedIds.has(node.id)) node.remove();
    });
  }

  clearRouteSchemas(): void {
    this.document.querySelectorAll<HTMLScriptElement>(this.managedSelector).forEach((node) => node.remove());
  }

  private upsertScript(id: string): HTMLScriptElement {
    const existing = this.document.getElementById(id);
    if (existing && existing.tagName.toLowerCase() === 'script') {
      const asScript = existing as HTMLScriptElement;
      asScript.type = 'application/ld+json';
      asScript.setAttribute('data-seo-route-schema', 'true');
      return asScript;
    }

    const script = this.document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    script.setAttribute('data-seo-route-schema', 'true');
    this.document.head.appendChild(script);
    return script;
  }
}
