import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LazyStylesService } from '../core/lazy-styles.service';
import { RichEditorComponent } from './rich-editor.component';

describe('RichEditorComponent', () => {
  let fixture: ComponentFixture<RichEditorComponent>;
  let component: RichEditorComponent;
  let styles: jasmine.SpyObj<LazyStylesService>;

  beforeEach(async () => {
    styles = jasmine.createSpyObj<LazyStylesService>('LazyStylesService', ['ensure']);
    styles.ensure.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [RichEditorComponent],
      providers: [{ provide: LazyStylesService, useValue: styles }]
    }).compileComponents();

    fixture = TestBed.createComponent(RichEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts editor initialization on view init', () => {
    const initSpy = spyOn<any>(component as any, 'initEditor').and.returnValue(Promise.resolve());

    component.ngAfterViewInit();

    expect(initSpy).toHaveBeenCalled();
  });

  it('applies external markdown updates and aria label changes', () => {
    const applyAriaSpy = spyOn<any>(component as any, 'applyAriaLabel');
    const editor = {
      getMarkdown: jasmine.createSpy('getMarkdown').and.returnValue('old'),
      setMarkdown: jasmine.createSpy('setMarkdown'),
      destroy: jasmine.createSpy('destroy')
    };
    (component as any).editor = editor;
    component.value = 'new';
    component.ariaLabel = 'Body editor';

    component.ngOnChanges({
      ariaLabel: { currentValue: 'Body editor', previousValue: '', firstChange: false, isFirstChange: () => false } as any,
      value: { currentValue: 'new', previousValue: 'old', firstChange: false, isFirstChange: () => false } as any
    });

    expect(applyAriaSpy).toHaveBeenCalled();
    expect(editor.setMarkdown).toHaveBeenCalledWith('new', false);
  });

  it('inserts markdown only when editor exists', () => {
    component.insertMarkdown('Hello');

    const editor = {
      insertText: jasmine.createSpy('insertText'),
      destroy: jasmine.createSpy('destroy')
    };
    (component as any).editor = editor;
    component.insertMarkdown('Hello');

    expect(editor.insertText).toHaveBeenCalledWith('Hello');
  });

  it('syncs theme class and applies aria label to textboxes', () => {
    const hostEl = component.host.nativeElement;
    const shell = document.createElement('div');
    shell.className = 'toastui-editor-defaultUI';
    const textbox = document.createElement('textarea');
    shell.appendChild(textbox);
    hostEl.appendChild(shell);

    component.ariaLabel = 'Markdown editor';
    document.documentElement.classList.add('dark');

    (component as any).syncThemeClass();
    (component as any).applyAriaLabel();

    expect(shell.classList.contains('toastui-editor-dark')).toBeTrue();
    expect(textbox.getAttribute('aria-label')).toBe('Markdown editor');

    document.documentElement.classList.remove('dark');
  });

  it('cleans up observer and editor on destroy', () => {
    const disconnect = jasmine.createSpy('disconnect');
    const destroy = jasmine.createSpy('destroy');

    (component as any).themeObserver = { disconnect };
    (component as any).editor = { destroy };

    component.ngOnDestroy();

    expect(disconnect).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
    expect((component as any).editor).toBeNull();
  });

  it('returns early in initEditor when destroyed before setup completes', async () => {
    (component as any).destroyed = true;

    await (component as any).initEditor();

    expect(styles.ensure).toHaveBeenCalled();
    expect((component as any).editor).toBeNull();
  });
});
