import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ContactComponent } from './contact.component';

describe('ContactComponent', () => {
  let meta: jasmine.SpyObj<Meta>;
  let title: jasmine.SpyObj<Title>;
  let translate: TranslateService;

  beforeEach(() => {
    meta = jasmine.createSpyObj<Meta>('Meta', ['updateTag']);
    title = jasmine.createSpyObj<Title>('Title', ['setTitle']);

    TestBed.configureTestingModule({
      imports: [ContactComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Title, useValue: title },
        { provide: Meta, useValue: meta }
      ]
    });

    translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        contact: { metaTitle: 'Contact | Moment Studio', metaDescription: 'Contact desc' }
      },
      true
    );
    translate.setTranslation(
      'ro',
      {
        contact: { metaTitle: 'Contact | Moment Studio (RO)', metaDescription: 'Descriere contact' }
      },
      true
    );
    translate.use('en');
  });

  it('sets meta tags on init', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    cmp.ngOnInit();

    expect(title.setTitle).toHaveBeenCalledWith('Contact | Moment Studio');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Contact desc' });
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Contact desc' });
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:title', content: 'Contact | Moment Studio' });
  });

  it('updates meta tags when language changes', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    cmp.ngOnInit();

    title.setTitle.calls.reset();
    meta.updateTag.calls.reset();

    translate.use('ro');

    expect(title.setTitle).toHaveBeenCalledWith('Contact | Moment Studio (RO)');
    expect(meta.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Descriere contact' });
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:description', content: 'Descriere contact' });
    expect(meta.updateTag).toHaveBeenCalledWith({ property: 'og:title', content: 'Contact | Moment Studio (RO)' });
  });

  it('stops updating after destroy', () => {
    const fixture = TestBed.createComponent(ContactComponent);
    const cmp = fixture.componentInstance;
    cmp.ngOnInit();
    cmp.ngOnDestroy();

    title.setTitle.calls.reset();
    meta.updateTag.calls.reset();

    translate.use('ro');

    expect(title.setTitle).not.toHaveBeenCalled();
    expect(meta.updateTag).not.toHaveBeenCalled();
  });
});

