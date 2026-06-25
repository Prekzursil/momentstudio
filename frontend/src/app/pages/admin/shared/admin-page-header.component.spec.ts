import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AdminPageHeaderComponent } from './admin-page-header.component';

@Component({
  standalone: true,
  imports: [AdminPageHeaderComponent],
  template: `
    <app-admin-page-header [titleKey]="titleKey" [hintKey]="hintKey">
      <ng-template #meta><span class="meta-slot">meta</span></ng-template>
      <ng-template #primaryActions><button class="primary">P</button></ng-template>
      <ng-template #secondaryActions><button class="secondary">S</button></ng-template>
    </app-admin-page-header>
  `,
})
class FullHostComponent {
  titleKey = 'adminUi.title';
  hintKey = 'adminUi.hint';
}

@Component({
  standalone: true,
  imports: [AdminPageHeaderComponent],
  template: `<app-admin-page-header [titleKey]="titleKey"></app-admin-page-header>`,
})
class BareHostComponent {
  titleKey = 'adminUi.title';
}

describe('AdminPageHeaderComponent', () => {
  it('renders hint, meta, and primary/secondary action slots when provided', () => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), FullHostComponent],
    });
    const fixture: ComponentFixture<FullHostComponent> = TestBed.createComponent(FullHostComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('p.text-sm')).not.toBeNull();
    expect(root.querySelector('.meta-slot')).not.toBeNull();
    expect(root.querySelector('.primary')).not.toBeNull();
    expect(root.querySelector('.secondary')).not.toBeNull();
    expect(root.querySelector('details')).not.toBeNull();
  });

  it('renders only the title when no hint or slots are present', () => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), BareHostComponent],
    });
    const fixture: ComponentFixture<BareHostComponent> = TestBed.createComponent(BareHostComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')).not.toBeNull();
    expect(root.querySelector('p.text-sm')).toBeNull();
    expect(root.querySelector('details')).toBeNull();
  });

  it('closeDetailsMenu closes the nearest details element', () => {
    TestBed.configureTestingModule({ imports: [TranslateModule.forRoot()] });
    const cmp = new AdminPageHeaderComponent();
    const details = document.createElement('details');
    details.open = true;
    const inner = document.createElement('button');
    details.appendChild(inner);
    cmp.closeDetailsMenu({ target: inner } as unknown as MouseEvent);
    expect(details.open).toBeFalse();
  });

  it('closeDetailsMenu is a no-op when there is no details ancestor', () => {
    const cmp = new AdminPageHeaderComponent();
    const orphan = document.createElement('button');
    expect(() => cmp.closeDetailsMenu({ target: orphan } as unknown as MouseEvent)).not.toThrow();
  });
});
