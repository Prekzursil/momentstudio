import { Component, Input } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AssetLibraryComponent } from '../shared/asset-library.component';
import { AdminContentMediaComponent } from './admin-content-media.component';

@Component({
  selector: 'app-asset-library',
  standalone: true,
  template: ''
})
class AssetLibraryStubComponent {
  @Input() titleKey = '';
  @Input() allowUpload = false;
  @Input() allowSelect = false;
  @Input() uploadKey = '';
  @Input() scopedKeys: string[] = [];
}

describe('AdminContentMediaComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminContentMediaComponent]
    })
      .overrideComponent(AdminContentMediaComponent, {
        remove: { imports: [AssetLibraryComponent] },
        add: { imports: [AssetLibraryStubComponent] }
      })
      .compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        adminUi: {
          content: {
            media: {
              title: 'Media library',
              hint: 'Manage all site images',
              libraryTitle: 'All media assets'
            }
          }
        }
      },
      true
    );
    translate.use('en');
  });

  it('renders media workspace heading and wires asset-library inputs', () => {
    const fixture = TestBed.createComponent(AdminContentMediaComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Media library');
    expect(text).toContain('Manage all site images');

    const libraryDebug = fixture.debugElement.query(By.directive(AssetLibraryStubComponent));
    expect(libraryDebug).toBeTruthy();
    const library = libraryDebug.componentInstance as AssetLibraryStubComponent;
    expect(library.titleKey).toBe('adminUi.content.media.libraryTitle');
    expect(library.allowUpload).toBeTrue();
    expect(library.allowSelect).toBeFalse();
    expect(library.uploadKey).toBe('site.assets');
    expect(library.scopedKeys).toEqual(
      jasmine.arrayContaining(['site.assets', 'site.social', 'site.company', 'home.hero', 'home.story', 'home.sections'])
    );
  });
});
