import { Component, Input } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { DamAssetLibraryComponent } from '../shared/dam-asset-library.component';
import { AdminContentMediaComponent } from './admin-content-media.component';

@Component({
  selector: 'app-dam-asset-library',
  standalone: true,
  template: ''
})
class DamAssetLibraryStubComponent {
  @Input() mode = '';
}

describe('AdminContentMediaComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminContentMediaComponent]
    })
      .overrideComponent(AdminContentMediaComponent, {
        remove: { imports: [DamAssetLibraryComponent] },
        add: { imports: [DamAssetLibraryStubComponent] }
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

  it('renders media workspace heading and includes DAM asset library', () => {
    const fixture = TestBed.createComponent(AdminContentMediaComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Media library');
    expect(text).toContain('Manage all site images');

    const libraryDebug = fixture.debugElement.query(By.directive(DamAssetLibraryStubComponent));
    expect(libraryDebug).toBeTruthy();
  });
});
