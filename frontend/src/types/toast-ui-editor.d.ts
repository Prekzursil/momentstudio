declare module '@toast-ui/editor' {
  export interface EditorOptions {
    el: HTMLElement;
    height?: string;
    initialEditType?: 'markdown' | 'wysiwyg';
    previewStyle?: 'tab' | 'vertical';
    hideModeSwitch?: boolean;
    usageStatistics?: boolean;
    initialValue?: string;
  }

  export default class Editor {
    constructor(options: EditorOptions);
    on(eventName: string, handler: () => void): void;
    getMarkdown(): string;
    setMarkdown(markdown: string, cursorToEnd?: boolean): void;
    insertText(text: string): void;
    destroy(): void;
  }
}

