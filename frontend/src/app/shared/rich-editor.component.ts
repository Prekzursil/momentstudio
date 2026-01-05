import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import Editor from '@toast-ui/editor';

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

  private editor: Editor | null = null;
  private isApplyingExternalUpdate = false;

  ngAfterViewInit(): void {
    this.editor = new Editor({
      el: this.host.nativeElement,
      height: this.height,
      initialEditType: this.initialEditType,
      previewStyle: 'vertical',
      hideModeSwitch: false,
      usageStatistics: false,
      initialValue: this.value || ''
    });

    this.editor.on('change', () => {
      if (!this.editor || this.isApplyingExternalUpdate) return;
      const next = this.editor.getMarkdown();
      this.value = next;
      this.valueChange.emit(next);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
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

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = null;
  }
}

