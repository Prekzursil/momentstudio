import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { HelpPanelComponent } from './help-panel.component';

@Component({
  standalone: true,
  imports: [HelpPanelComponent],
  template: `
    <app-help-panel
      [titleKey]="titleKey"
      [subtitleKey]="subtitleKey"
      [mediaSrc]="mediaSrc"
      [mediaAltKey]="mediaAltKey"
      [mediaCaptionKey]="mediaCaptionKey"
      [open]="open"
    >
      <p class="projected">child</p>
    </app-help-panel>
  `,
})
class HostComponent {
  titleKey = 'adminUi.help.title';
  subtitleKey = '';
  mediaSrc = '';
  mediaAltKey = '';
  mediaCaptionKey = '';
  open = false;
}

describe('HelpPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), HostComponent],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function el(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  it('renders a collapsed panel with title and projected content only', () => {
    fixture.detectChanges();
    expect(el('details')?.hasAttribute('open')).toBeFalse();
    expect(el('summary')).not.toBeNull();
    expect(el('p.text-xs')).toBeNull();
    expect(el('figure')).toBeNull();
    expect(el('.projected')).not.toBeNull();
  });

  it('shows the subtitle and an open panel when configured', () => {
    host.subtitleKey = 'adminUi.help.subtitle';
    host.open = true;
    fixture.detectChanges();
    expect(el('details')?.hasAttribute('open')).toBeTrue();
    expect(el('p.text-xs')).not.toBeNull();
  });

  it('renders media with empty alt when no alt key is given', () => {
    host.mediaSrc = '/img.png';
    fixture.detectChanges();
    const img = el('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('alt')).toBe('');
    expect(el('figcaption')).toBeNull();
  });

  it('renders media alt and caption when keys are provided', () => {
    host.mediaSrc = '/img.png';
    host.mediaAltKey = 'adminUi.help.alt';
    host.mediaCaptionKey = 'adminUi.help.caption';
    fixture.detectChanges();
    const img = el('img') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('adminUi.help.alt');
    expect(el('figcaption')).not.toBeNull();
  });
});
