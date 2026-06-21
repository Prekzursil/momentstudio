import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';

import { LocalizedTextEditorComponent } from './localized-text-editor.component';

describe('LocalizedTextEditorComponent', () => {
  let fixture: ComponentFixture<LocalizedTextEditorComponent>;
  let component: LocalizedTextEditorComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LocalizedTextEditorComponent, TranslateModule.forRoot()],
    });
    fixture = TestBed.createComponent(LocalizedTextEditorComponent);
    component = fixture.componentInstance;
  });

  it('renders single-line inputs by default', () => {
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('input')).length).toBe(2);
    expect(fixture.debugElement.queryAll(By.css('textarea')).length).toBe(0);
  });

  it('renders textareas when multiline', () => {
    component.multiline = true;
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('textarea')).length).toBe(2);
    expect(fixture.debugElement.queryAll(By.css('input')).length).toBe(0);
  });

  it('shows label, hint and copy buttons', () => {
    component.label = 'Title';
    component.hint = 'Helpful hint';
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Title');
    expect(text).toContain('Helpful hint');
    expect(fixture.debugElement.queryAll(By.css('button')).length).toBe(2);
  });

  it('hides the copy buttons when showCopy is false', () => {
    component.showCopy = false;
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('button')).length).toBe(0);
  });

  it('copies text from one language to another', () => {
    component.value = { en: 'Hello', ro: 'Salut' };
    component.copy('en', 'ro');
    expect(component.value.ro).toBe('Hello');
    component.copy('ro', 'en');
    expect(component.value.en).toBe('Hello');
  });

  it('falls back to an empty string when the source is empty', () => {
    component.value = { en: '', ro: 'Salut' };
    component.copy('en', 'ro');
    expect(component.value.ro).toBe('');
  });
});
