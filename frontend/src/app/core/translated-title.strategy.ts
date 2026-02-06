import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private lastSnapshot: RouterStateSnapshot | null = null;

  constructor(
    private readonly title: Title,
    private readonly translate: TranslateService
  ) {
    super();
    this.translate.onLangChange.subscribe(() => {
      if (this.lastSnapshot) this.updateTitle(this.lastSnapshot);
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.lastSnapshot = snapshot;
    const raw = this.buildTitle(snapshot);
    if (!raw) return;
    const translated = this.translate.instant(raw);
    this.title.setTitle(translated && translated !== raw ? translated : raw);
  }
}

