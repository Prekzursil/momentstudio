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

  constructor(private readonly auth: AuthService) {
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

  private isMode(value: unknown): value is CmsEditorMode {
    return value === 'simple' || value === 'advanced';
  }

  private isPreviewDevice(value: unknown): value is CmsPreviewDevice {
    return value === 'desktop' || value === 'tablet' || value === 'mobile';
  }

  private isPreviewLayout(value: unknown): value is CmsPreviewLayout {
    return value === 'stacked' || value === 'split';
  }

  private isPreviewLang(value: unknown): value is CmsPreviewLang {
    return value === 'en' || value === 'ro';
  }

  private isPreviewTheme(value: unknown): value is CmsPreviewTheme {
    return value === 'light' || value === 'dark';
  }

  private isTranslationLayout(value: unknown): value is CmsTranslationLayout {
    return value === 'single' || value === 'sideBySide';
  }

  private applyParsedPrefs(data: Record<string, unknown>): void {
    type PrefBinding = {
      key: string;
      isValid: (value: unknown) => boolean;
      apply: (value: unknown) => void;
    };
    const bindings: PrefBinding[] = [
      { key: 'mode', isValid: (value) => this.isMode(value), apply: (value) => this.mode.set(value as CmsEditorMode) },
      {
        key: 'previewDevice',
        isValid: (value) => this.isPreviewDevice(value),
        apply: (value) => this.previewDevice.set(value as CmsPreviewDevice),
      },
      {
        key: 'previewLayout',
        isValid: (value) => this.isPreviewLayout(value),
        apply: (value) => this.previewLayout.set(value as CmsPreviewLayout),
      },
      {
        key: 'previewLang',
        isValid: (value) => this.isPreviewLang(value),
        apply: (value) => this.previewLang.set(value as CmsPreviewLang),
      },
      {
        key: 'previewTheme',
        isValid: (value) => this.isPreviewTheme(value),
        apply: (value) => this.previewTheme.set(value as CmsPreviewTheme),
      },
      {
        key: 'translationLayout',
        isValid: (value) => this.isTranslationLayout(value),
        apply: (value) => this.translationLayout.set(value as CmsTranslationLayout),
      },
    ];
    for (const binding of bindings) {
      const value = data[binding.key];
      if (!binding.isValid(value)) continue;
      binding.apply(value);
    }
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return;
      const data = (JSON.parse(raw) ?? {}) as Record<string, unknown>;
      this.applyParsedPrefs(data);
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
