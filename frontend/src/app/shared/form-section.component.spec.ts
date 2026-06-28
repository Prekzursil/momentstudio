import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { FormSectionComponent } from './form-section.component';

@Component({
  standalone: true,
  imports: [FormSectionComponent],
  template: `
    <app-form-section
      [title]="title"
      [titleKey]="titleKey"
      [description]="description"
      [descriptionKey]="descriptionKey"
    >
      <button formSectionActions type="button">Action</button>
      <div class="projected">Body content</div>
    </app-form-section>
  `,
})
class HostComponent {
  title = '';
  titleKey = '';
  description = '';
  descriptionKey = '';
}

describe('FormSectionComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      title: { key: 'Translated Title' },
      description: { key: 'Translated Description' },
    });
    translate.use('en');

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function titleText(): string {
    return fixture.debugElement
      .query(By.css('p.font-semibold'))
      .nativeElement.textContent.trim();
  }

  function descriptionEl() {
    return fixture.debugElement.query(By.css('p.text-slate-600'));
  }

  it('creates the component with empty defaults', () => {
    const component = fixture.debugElement.query(
      By.directive(FormSectionComponent),
    ).componentInstance as FormSectionComponent;
    expect(component.title).toBe('');
    expect(component.titleKey).toBe('');
    expect(component.description).toBe('');
    expect(component.descriptionKey).toBe('');
  });

  it('renders the literal title when provided', () => {
    host.title = 'Shipping details';
    fixture.detectChanges();
    expect(titleText()).toBe('Shipping details');
  });

  it('falls back to the translated titleKey when title is empty', () => {
    host.title = '';
    host.titleKey = 'title.key';
    fixture.detectChanges();
    expect(titleText()).toBe('Translated Title');
  });

  it('prefers the literal title over the titleKey', () => {
    host.title = 'Literal wins';
    host.titleKey = 'title.key';
    fixture.detectChanges();
    expect(titleText()).toBe('Literal wins');
  });

  it('renders an empty title when neither title nor titleKey is set', () => {
    fixture.detectChanges();
    expect(titleText()).toBe('');
  });

  it('hides the description paragraph when description and descriptionKey are empty', () => {
    fixture.detectChanges();
    expect(descriptionEl()).toBeNull();
  });

  it('renders the literal description when provided', () => {
    host.description = 'Where should we send it?';
    fixture.detectChanges();
    expect(descriptionEl()).not.toBeNull();
    expect(descriptionEl().nativeElement.textContent.trim()).toBe(
      'Where should we send it?',
    );
  });

  it('falls back to the translated descriptionKey when description is empty', () => {
    host.descriptionKey = 'description.key';
    fixture.detectChanges();
    expect(descriptionEl()).not.toBeNull();
    expect(descriptionEl().nativeElement.textContent.trim()).toBe(
      'Translated Description',
    );
  });

  it('prefers the literal description over the descriptionKey', () => {
    host.description = 'Literal description';
    host.descriptionKey = 'description.key';
    fixture.detectChanges();
    expect(descriptionEl().nativeElement.textContent.trim()).toBe(
      'Literal description',
    );
  });

  it('projects default content and the formSectionActions slot', () => {
    fixture.detectChanges();
    const actions = fixture.debugElement.query(By.css('[formSectionActions]'));
    const body = fixture.debugElement.query(By.css('.projected'));
    expect(actions.nativeElement.textContent.trim()).toBe('Action');
    expect(body.nativeElement.textContent.trim()).toBe('Body content');
  });
});
