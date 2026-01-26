import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from '../../../shared/button.component';

export type CmsBlockLibraryContext = 'home' | 'page';
export type CmsBlockLibraryBlockType = 'text' | 'image' | 'gallery' | 'banner' | 'carousel';
export type CmsBlockLibraryTemplate = 'blank' | 'starter';

type BlockDef = {
  type: CmsBlockLibraryBlockType;
  titleKey: string;
  descKey: string;
  gradient: string;
};

@Component({
  selector: 'app-cms-block-library',
  standalone: true,
  imports: [CommonModule, TranslateModule, ButtonComponent],
  template: `
    <div class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/30">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="grid gap-0.5 min-w-0">
          <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.content.blockLibrary.title' | translate }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.content.blockLibrary.hint' | translate }}</p>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ 'adminUi.content.blockLibrary.templateLabel' | translate }}</span>
          <div class="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-semibold"
              [class.bg-slate-900]="template() === 'starter'"
              [class.text-white]="template() === 'starter'"
              [class.text-slate-700]="template() !== 'starter'"
              [class.dark:text-slate-200]="template() !== 'starter'"
              (click)="template.set('starter')"
            >
              {{ 'adminUi.content.blockLibrary.templates.starter' | translate }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-semibold"
              [class.bg-slate-900]="template() === 'blank'"
              [class.text-white]="template() === 'blank'"
              [class.text-slate-700]="template() !== 'blank'"
              [class.dark:text-slate-200]="template() !== 'blank'"
              (click)="template.set('blank')"
            >
              {{ 'adminUi.content.blockLibrary.templates.blank' | translate }}
            </button>
          </div>
        </div>
      </div>

      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div
          *ngFor="let b of blocks"
          class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm cursor-grab active:cursor-grabbing dark:border-slate-800 dark:bg-slate-900"
          draggable="true"
          (dragstart)="onDragStart($event, b.type)"
          (dragend)="onDragEnd()"
        >
          <div class="h-12 rounded-lg bg-gradient-to-r" [ngClass]="b.gradient"></div>
          <p class="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-50">{{ b.titleKey | translate }}</p>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">{{ b.descKey | translate }}</p>
          <div class="mt-3 flex justify-end">
            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.add' | translate" (action)="addBlock(b.type)"></app-button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class CmsBlockLibraryComponent {
  @Input() context: CmsBlockLibraryContext = 'page';
  @Output() add = new EventEmitter<{ type: CmsBlockLibraryBlockType; template: CmsBlockLibraryTemplate }>();
  @Output() dragActive = new EventEmitter<boolean>();

  template = signal<CmsBlockLibraryTemplate>('starter');

  readonly blocks: BlockDef[] = [
    {
      type: 'text',
      titleKey: 'adminUi.home.sections.blocks.text',
      descKey: 'adminUi.content.blockLibrary.items.text',
      gradient: 'from-indigo-500/50 to-fuchsia-500/50'
    },
    {
      type: 'image',
      titleKey: 'adminUi.home.sections.blocks.image',
      descKey: 'adminUi.content.blockLibrary.items.image',
      gradient: 'from-sky-500/50 to-indigo-500/50'
    },
    {
      type: 'gallery',
      titleKey: 'adminUi.home.sections.blocks.gallery',
      descKey: 'adminUi.content.blockLibrary.items.gallery',
      gradient: 'from-emerald-500/50 to-teal-500/50'
    },
    {
      type: 'banner',
      titleKey: 'adminUi.home.sections.blocks.banner',
      descKey: 'adminUi.content.blockLibrary.items.banner',
      gradient: 'from-amber-500/50 to-orange-500/50'
    },
    {
      type: 'carousel',
      titleKey: 'adminUi.home.sections.blocks.carousel',
      descKey: 'adminUi.content.blockLibrary.items.carousel',
      gradient: 'from-violet-500/50 to-indigo-500/50'
    }
  ];

  addBlock(type: CmsBlockLibraryBlockType): void {
    this.add.emit({ type, template: this.template() });
  }

  onDragStart(event: DragEvent, type: CmsBlockLibraryBlockType): void {
    try {
      const payload = JSON.stringify({ kind: 'cms-block', scope: this.context, type, template: this.template() });
      event.dataTransfer?.setData('text/plain', payload);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    } catch {
      // ignore
    }
    this.dragActive.emit(true);
  }

  onDragEnd(): void {
    this.dragActive.emit(false);
  }
}

