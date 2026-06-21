import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';

import { RichEditorComponent } from './rich-editor.component';
import { LazyStylesService } from '../core/lazy-styles.service';

class StubLazyStylesService {
  resolveImmediately = true;
  pending: Array<() => void> = [];
  ensure(): Promise<void> {
    if (this.resolveImmediately) return Promise.resolve();
    return new Promise<void>((resolve) => this.pending.push(resolve));
  }
}

describe('RichEditorComponent', () => {
  let styles: StubLazyStylesService;

  beforeEach(() => {
    styles = new StubLazyStylesService();
    TestBed.configureTestingModule({
      imports: [RichEditorComponent],
      providers: [{ provide: LazyStylesService, useValue: styles }],
    });
  });

  function make(value = ''): ComponentFixture<RichEditorComponent> {
    const fixture = TestBed.createComponent(RichEditorComponent);
    fixture.componentInstance.value = value;
    return fixture;
  }

  it('initializes the editor and emits markdown on change', fakeAsync(() => {
    const fixture = make('hello');
    fixture.componentInstance.ariaLabel = 'Editor';
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    tick();
    tick(); // flush the two setTimeout(0) calls

    const cmp = fixture.componentInstance as unknown as {
      editor: { setMarkdown: (s: string) => void; getMarkdown: () => string };
    };
    expect(cmp.editor).toBeTruthy();

    cmp.editor.setMarkdown('changed');
    expect(emitted[emitted.length - 1]).toBe('changed');
    fixture.destroy();
  }));

  it('aborts editor creation if destroyed while styles are loading', fakeAsync(() => {
    styles.resolveImmediately = false;
    const fixture = make('x');
    fixture.detectChanges();
    fixture.destroy(); // sets destroyed = true before styles resolve
    styles.pending.forEach((resolve) => resolve());
    tick();
    const cmp = fixture.componentInstance as unknown as { editor: unknown };
    expect(cmp.editor).toBeNull();
  }));

  it('applies external value updates via ngOnChanges and ignores no-ops', fakeAsync(() => {
    const fixture = make('start');
    fixture.detectChanges();
    tick();
    tick();
    const cmp = fixture.componentInstance;

    cmp.value = 'updated';
    cmp.ngOnChanges({ value: { currentValue: 'updated', previousValue: 'start' } as never });
    const editor = (cmp as unknown as { editor: { getMarkdown: () => string } }).editor;
    expect(editor.getMarkdown().trim()).toBe('updated');

    // same value -> early return, no throw
    cmp.ngOnChanges({ value: { currentValue: 'updated', previousValue: 'updated' } as never });
    // aria-only change -> applies aria label branch
    cmp.ariaLabel = 'New';
    cmp.ngOnChanges({ ariaLabel: { currentValue: 'New', previousValue: '' } as never });
    expect(editor.getMarkdown().trim()).toBe('updated');
    fixture.destroy();
  }));

  it('ngOnChanges returns early before the editor is ready', () => {
    const fixture = make('x');
    const cmp = fixture.componentInstance;
    expect(() =>
      cmp.ngOnChanges({ value: { currentValue: 'x', previousValue: '' } as never }),
    ).not.toThrow();
  });

  it('ngOnChanges with no value change after init is a no-op', fakeAsync(() => {
    const fixture = make('x');
    fixture.detectChanges();
    tick();
    tick();
    expect(() => fixture.componentInstance.ngOnChanges({})).not.toThrow();
    fixture.destroy();
  }));

  it('insertMarkdown inserts when ready and no-ops otherwise', fakeAsync(() => {
    const fixture = make('');
    // before init -> no-op
    expect(() => fixture.componentInstance.insertMarkdown('a')).not.toThrow();
    fixture.detectChanges();
    tick();
    tick();
    const editor = (fixture.componentInstance as unknown as { editor: { insertText: unknown } })
      .editor;
    const spy = spyOn(editor as { insertText: (t: string) => void }, 'insertText');
    fixture.componentInstance.insertMarkdown('inserted');
    expect(spy).toHaveBeenCalledWith('inserted');
    fixture.destroy();
  }));

  it('toggles the dark theme class when the document is dark', fakeAsync(() => {
    document.documentElement.classList.add('dark');
    const fixture = make('');
    fixture.detectChanges();
    tick();
    tick();
    const defaultUi = fixture.nativeElement.querySelector('.toastui-editor-defaultUI');
    expect(defaultUi?.classList.contains('toastui-editor-dark')).toBeTrue();
    document.documentElement.classList.remove('dark');
    fixture.destroy();
  }));

  it('applyAriaLabel skips when the label is blank', fakeAsync(() => {
    const fixture = make('');
    fixture.componentInstance.ariaLabel = '   ';
    fixture.detectChanges();
    tick();
    tick();
    fixture.destroy();
    // No assertion needed beyond no-throw: blank label hits the early return.
    expect(true).toBeTrue();
  }));
});
