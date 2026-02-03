import { DOCUMENT } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import Editor from '@toast-ui/editor';
import { LazyStylesService } from '../core/lazy-styles.service';

@Component({
  selector: 'app-rich-editor',
  standalone: true,
  template: `<div #host class="rounded-lg border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"></div>`
})
export class RichEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  @Input() height = '420px';
  @Input() initialEditType: 'markdown' | 'wysiwyg' = 'markdown';
  @Input() ariaLabel = '';

  private document: Document = inject(DOCUMENT);
  private editor: Editor | null = null;
  private isApplyingExternalUpdate = false;
  private themeObserver?: MutationObserver;
  private destroyed = false;
  private styles = inject(LazyStylesService);

  ngAfterViewInit(): void {
    void this.initEditor();
  }

  private async initEditor(): Promise<void> {
    await Promise.all([
      this.styles.ensure('toastui-editor', 'assets/vendor/toastui/toastui-editor.css'),
      this.styles.ensure('toastui-editor-dark', 'assets/vendor/toastui/toastui-editor-dark.css')
    ]);

    if (this.destroyed) return;

    this.editor = new Editor({
      el: this.host.nativeElement,
      height: this.height,
      initialEditType: this.initialEditType,
      previewStyle: 'vertical',
      hideModeSwitch: false,
      usageStatistics: false,
      initialValue: this.value || ''
    });

    this.syncThemeClass();
    this.applyAriaLabel();
    if (typeof MutationObserver !== 'undefined') {
      this.themeObserver = new MutationObserver(() => this.syncThemeClass());
      this.themeObserver.observe(this.document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    setTimeout(() => this.syncThemeClass(), 0);
    setTimeout(() => this.applyAriaLabel(), 0);

    this.editor.on('change', () => {
      if (!this.editor || this.isApplyingExternalUpdate) return;
      const next = this.editor.getMarkdown();
      this.value = next;
      this.valueChange.emit(next);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ariaLabel']) {
      this.applyAriaLabel();
    }
    if (!this.editor) return;
    if (!changes['value']) return;
    const next = this.value || '';
    const current = this.editor.getMarkdown();
    if (next === current) return;

    this.isApplyingExternalUpdate = true;
    this.editor.setMarkdown(next, false);
    this.isApplyingExternalUpdate = false;
  }

  insertMarkdown(text: string): void {
    if (!this.editor) return;
    this.editor.insertText(text);
  }

  private syncThemeClass(): void {
    if (this.destroyed || !this.host?.nativeElement) return;
    const isDark = this.document.documentElement.classList.contains('dark');
    const root = this.host.nativeElement.querySelector('.toastui-editor-defaultUI') as HTMLElement | null;
    const target = root ?? this.host.nativeElement;
    target.classList.toggle('toastui-editor-dark', isDark);
  }

  private applyAriaLabel(): void {
    if (this.destroyed || !this.host?.nativeElement) return;
    const label = String(this.ariaLabel || '').trim();
    if (!label) return;
    const nodes = this.host.nativeElement.querySelectorAll<HTMLElement>('[role="textbox"], textarea');
    nodes.forEach((node) => node.setAttribute('aria-label', label));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.themeObserver?.disconnect();
    this.themeObserver = undefined;
    this.editor?.destroy();
    this.editor = null;
  }
}
