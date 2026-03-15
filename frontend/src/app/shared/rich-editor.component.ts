import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { LazyStylesService } from '../core/lazy-styles.service';

interface EditorInit {
  el: HTMLDivElement;
  height: string;
  initialValue: string;
}

interface EditorLike {
  getMarkdown(): string;
  setMarkdown(value: string, cursorToEnd?: boolean): void;
  insertText(text: string): void;
  on(event: 'change', callback: () => void): void;
  destroy(): void;
}

class NativeMarkdownEditor implements EditorLike {
  private readonly host: HTMLDivElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly listeners: Array<() => void> = [];
  private readonly changeCallbacks: Array<() => void> = [];

  constructor(opts: EditorInit) {
    this.host = opts.el;
    this.host.innerHTML = '';

    const shell = this.host.ownerDocument.createElement('div');
    shell.className = 'toastui-editor-defaultUI';

    this.textarea = this.host.ownerDocument.createElement('textarea');
    this.textarea.setAttribute('role', 'textbox');
    this.textarea.style.width = '100%';
    this.textarea.style.minHeight = opts.height;
    this.textarea.style.padding = '0.75rem';
    this.textarea.style.border = '0';
    this.textarea.style.outline = 'none';
    this.textarea.style.resize = 'vertical';
    this.textarea.value = opts.initialValue;

    const onInput = () => {
      for (const callback of this.changeCallbacks) callback();
    };

    this.textarea.addEventListener('input', onInput);
    this.listeners.push(() => this.textarea.removeEventListener('input', onInput));

    shell.appendChild(this.textarea);
    this.host.appendChild(shell);
  }

  getMarkdown(): string {
    return this.textarea.value;
  }

  setMarkdown(value: string, cursorToEnd = false): void {
    this.textarea.value = value;
    if (cursorToEnd) {
      const end = this.textarea.value.length;
      this.textarea.selectionStart = end;
      this.textarea.selectionEnd = end;
    }
  }

  insertText(text: string): void {
    const start = this.textarea.selectionStart ?? this.textarea.value.length;
    const end = this.textarea.selectionEnd ?? this.textarea.value.length;
    const current = this.textarea.value;
    this.textarea.value = `${current.slice(0, start)}${text}${current.slice(end)}`;
    const nextCursor = start + text.length;
    this.textarea.selectionStart = nextCursor;
    this.textarea.selectionEnd = nextCursor;
    for (const callback of this.changeCallbacks) callback();
  }

  on(event: 'change', callback: () => void): void {
    if (event === 'change') this.changeCallbacks.push(callback);
  }

  destroy(): void {
    for (const dispose of this.listeners) dispose();
    this.listeners.length = 0;
    this.changeCallbacks.length = 0;
    this.host.innerHTML = '';
  }
}

@Component({
  selector: 'app-rich-editor',
  standalone: true,
  template:
    '<div #host class="rounded-lg border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"></div>',
})
export class RichEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  @Input() height = '420px';
  @Input() initialEditType: 'markdown' | 'wysiwyg' = 'markdown';
  @Input() ariaLabel = '';

  private readonly document: Document = inject(DOCUMENT);
  private editor: EditorLike | null = null;
  private isApplyingExternalUpdate = false;
  private themeObserver?: MutationObserver;
  private destroyed = false;
  private readonly styles = inject(LazyStylesService);

  ngAfterViewInit(): void {
    void this.initEditor();
  }

  private async initEditor(): Promise<void> {
    await Promise.all([
      this.styles.ensure('toastui-editor', 'assets/vendor/toastui/toastui-editor.css'),
      this.styles.ensure('toastui-editor-dark', 'assets/vendor/toastui/toastui-editor-dark.css'),
    ]);

    if (this.destroyed) return;

    this.editor = new NativeMarkdownEditor({
      el: this.host.nativeElement,
      height: this.height,
      initialValue: this.value || '',
    });

    this.syncThemeClass();
    this.applyAriaLabel();

    if (typeof MutationObserver !== 'undefined') {
      this.themeObserver = new MutationObserver(() => this.syncThemeClass());
      this.themeObserver.observe(this.document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
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
