import { Injectable, signal } from '@angular/core';
import { AuthService } from '../../../core/auth.service';

export type CmsEditorMode = 'simple' | 'advanced';
export type CmsPreviewDevice = 'desktop' | 'tablet' | 'mobile';
export type CmsPreviewLayout = 'stacked' | 'split';
export type CmsPreviewLang = 'en' | 'ro';
export type CmsPreviewTheme = 'light' | 'dark';
export type CmsTranslationLayout = 'single' | 'sideBySide';

@Injectable({ providedIn: 'root' })
export class CmsEditorPrefsService {
  mode = signal<CmsEditorMode>('simple');
  previewDevice = signal<CmsPreviewDevice>('desktop');
  previewLayout = signal<CmsPreviewLayout>('stacked');
  previewLang = signal<CmsPreviewLang>('en');
  previewTheme = signal<CmsPreviewTheme>('light');
  translationLayout = signal<CmsTranslationLayout>('single');

  constructor(private auth: AuthService) {
    this.load();
  }

  setMode(mode: CmsEditorMode): void {
    this.mode.set(mode);
    this.persist();
  }

  setPreviewDevice(device: CmsPreviewDevice): void {
    this.previewDevice.set(device);
    this.persist();
  }

  setPreviewLayout(layout: CmsPreviewLayout): void {
    this.previewLayout.set(layout);
    this.persist();
  }

  setPreviewLang(lang: CmsPreviewLang): void {
    this.previewLang.set(lang);
    this.persist();
  }

  setPreviewTheme(theme: CmsPreviewTheme): void {
    this.previewTheme.set(theme);
    this.persist();
  }

  setTranslationLayout(layout: CmsTranslationLayout): void {
    this.translationLayout.set(layout);
    this.persist();
  }

  toggleMode(): void {
    this.setMode(this.mode() === 'simple' ? 'advanced' : 'simple');
  }

  private storageKey(): string {
    const userId = (this.auth.user()?.id ?? '').trim();
    return `admin.content.editorMode.v1:${userId || 'anonymous'}`;
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const mode = (parsed as any)?.mode;
      if (mode === 'simple' || mode === 'advanced') {
        this.mode.set(mode);
      }
      const previewDevice = (parsed as any)?.previewDevice;
      if (previewDevice === 'desktop' || previewDevice === 'tablet' || previewDevice === 'mobile') {
        this.previewDevice.set(previewDevice);
      }
      const previewLayout = (parsed as any)?.previewLayout;
      if (previewLayout === 'stacked' || previewLayout === 'split') {
        this.previewLayout.set(previewLayout);
      }
      const previewLang = (parsed as any)?.previewLang;
      if (previewLang === 'en' || previewLang === 'ro') {
        this.previewLang.set(previewLang);
      }
      const previewTheme = (parsed as any)?.previewTheme;
      if (previewTheme === 'light' || previewTheme === 'dark') {
        this.previewTheme.set(previewTheme);
      }
      const translationLayout = (parsed as any)?.translationLayout;
      if (translationLayout === 'single' || translationLayout === 'sideBySide') {
        this.translationLayout.set(translationLayout);
      }
    } catch {
      // ignore
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        this.storageKey(),
        JSON.stringify({
          mode: this.mode(),
          previewDevice: this.previewDevice(),
          previewLayout: this.previewLayout(),
          previewLang: this.previewLang(),
          previewTheme: this.previewTheme(),
          translationLayout: this.translationLayout()
        })
      );
    } catch {
      // ignore
    }
  }
}
