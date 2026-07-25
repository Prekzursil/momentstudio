import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import type { AdminProductListItem } from '../../../core/admin-products.service';
import { AdminProductsRelationshipsManagerComponent } from './admin-products-relationships-manager.component';

function makeItem(overrides: Partial<AdminProductListItem> = {}): AdminProductListItem {
  return {
    id: 'p1',
    slug: 'product-one',
    sku: 'SKU-1',
    name: 'Product One',
    base_price: 1000,
    currency: 'USD',
    status: 'published',
    is_active: true,
    is_featured: false,
    stock_quantity: 5,
    category_slug: 'cat',
    category_name: 'Category',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('AdminProductsRelationshipsManagerComponent', () => {
  let fixture: ComponentFixture<AdminProductsRelationshipsManagerComponent>;
  let component: AdminProductsRelationshipsManagerComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminProductsRelationshipsManagerComponent, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(AdminProductsRelationshipsManagerComponent);
    component = fixture.componentInstance;
  });

  it('creates with documented input defaults', () => {
    expect(component).toBeTruthy();
    expect(component.hasEditingSlug).toBe(false);
    expect(component.relationshipSearch).toBe('');
    expect(component.relationshipSearchLoading).toBe(false);
    expect(component.relationshipSearchResults).toEqual([]);
    expect(component.relationshipsRelated).toEqual([]);
    expect(component.relationshipsUpsells).toEqual([]);
    expect(component.relationshipsLoading).toBe(false);
    expect(component.relationshipsSaving).toBe(false);
    expect(component.relationshipsError).toBeNull();
    expect(component.relationshipsMessage).toBeNull();
  });

  it('shows the save-first notice and hides the count badge when nothing is editing or related', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('adminUi.products.relationships.saveFirst');
    // No related/upsell items -> count badge is not rendered.
    const badge = fixture.debugElement.query(By.css('span.rounded-full'));
    expect(badge).toBeNull();
  });

  it('hides the save-first notice once a slug is being edited', () => {
    component.hasEditingSlug = true;
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('adminUi.products.relationships.saveFirst');
  });

  it('renders the count badge summing related and upsell items', () => {
    component.relationshipsRelated = [makeItem({ id: 'r1' }), makeItem({ id: 'r2' })];
    component.relationshipsUpsells = [makeItem({ id: 'u1' })];
    fixture.detectChanges();
    const badge = fixture.debugElement.query(By.css('span.rounded-full'));
    expect(badge).toBeTruthy();
    expect((badge.nativeElement.textContent as string).trim()).toBe('3');
  });

  it('renders the error banner when relationshipsError is set', () => {
    component.relationshipsError = 'Boom';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain('Boom');
  });

  it('renders the success message banner when relationshipsMessage is set', () => {
    component.relationshipsMessage = 'Saved!';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain('Saved!');
  });

  it('shows the search-loading indicator while searching', () => {
    component.relationshipSearchLoading = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain(
      'adminUi.products.relationships.searchLoading',
    );
  });

  it('disables the search input while the search is loading', () => {
    component.relationshipSearchLoading = true;
    fixture.detectChanges();
    const input = fixture.debugElement.query(By.css('app-input'));
    expect(input.componentInstance.disabled).toBe(true);
  });

  it('disables the search input while relationships are loading', () => {
    component.relationshipsLoading = true;
    fixture.detectChanges();
    const input = fixture.debugElement.query(By.css('app-input'));
    expect(input.componentInstance.disabled).toBe(true);
  });

  it('enables the search input when nothing is loading', () => {
    fixture.detectChanges();
    const input = fixture.debugElement.query(By.css('app-input'));
    expect(input.componentInstance.disabled).toBe(false);
  });

  it('emits relationshipSearchChanged when the input value changes', () => {
    const spy = jasmine.createSpy('search');
    component.relationshipSearchChanged.subscribe(spy);
    fixture.detectChanges();
    const input = fixture.debugElement.query(By.css('app-input'));
    input.componentInstance.valueChange.emit('shoes');
    expect(spy).toHaveBeenCalledWith('shoes');
  });

  it('renders search results and emits add-related / add-upsell with the item', () => {
    component.hasEditingSlug = true;
    const result = makeItem({ id: 's1', name: 'Result', slug: 'result', sku: 'SKU-R' });
    component.relationshipSearchResults = [result];
    const addSpy = jasmine.createSpy('add');
    component.addRequested.subscribe(addSpy);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Result');
    expect(text).toContain('result');
    expect(text).toContain('SKU-R');

    // Within a search-result row, the first two buttons are addRelated / addUpsell.
    const resultRow = fixture.debugElement.query(
      By.css('.rounded-lg.border .flex.items-center.gap-1'),
    );
    const buttons = resultRow.queryAll(By.css('app-button'));
    buttons[0].componentInstance.action.emit();
    buttons[1].componentInstance.action.emit();

    expect(addSpy).toHaveBeenCalledWith({ item: result, kind: 'related' });
    expect(addSpy).toHaveBeenCalledWith({ item: result, kind: 'upsell' });
  });

  it('disables add buttons in search results when no slug is being edited', () => {
    component.hasEditingSlug = false;
    component.relationshipSearchResults = [makeItem({ id: 's1' })];
    fixture.detectChanges();
    const resultRow = fixture.debugElement.query(
      By.css('.rounded-lg.border .flex.items-center.gap-1'),
    );
    const buttons = resultRow.queryAll(By.css('app-button'));
    expect(buttons[0].componentInstance.disabled).toBe(true);
    expect(buttons[1].componentInstance.disabled).toBe(true);
  });

  it('shows empty-state copy for both related and upsell columns when empty', () => {
    fixture.detectChanges();
    const empties = fixture.debugElement
      .queryAll(By.css('div'))
      .filter((d) =>
        (d.nativeElement.textContent as string).includes('adminUi.products.relationships.empty'),
      );
    expect(empties.length).toBeGreaterThanOrEqual(2);
  });

  it('emits move up/down and remove for a related item with correct payloads', () => {
    component.relationshipsRelated = [
      makeItem({ id: 'r1', name: 'Rel A' }),
      makeItem({ id: 'r2', name: 'Rel B' }),
    ];
    const moveSpy = jasmine.createSpy('move');
    const removeSpy = jasmine.createSpy('remove');
    component.moveRequested.subscribe(moveSpy);
    component.removeRequested.subscribe(removeSpy);
    fixture.detectChanges();

    // The two relationship columns; first column is "related".
    const columns = fixture.debugElement.queryAll(By.css('.grid.gap-4 > div'));
    const relatedRows = columns[0].queryAll(By.css('.flex.items-center.justify-between'));
    // Second related row: up is enabled, can emit up/down/remove.
    const secondRowButtons = relatedRows[1].queryAll(By.css('app-button'));
    secondRowButtons[0].componentInstance.action.emit(); // up
    secondRowButtons[1].componentInstance.action.emit(); // down
    secondRowButtons[2].componentInstance.action.emit(); // remove

    expect(moveSpy).toHaveBeenCalledWith({ kind: 'related', index: 1, direction: -1 });
    expect(moveSpy).toHaveBeenCalledWith({ kind: 'related', index: 1, direction: 1 });
    expect(removeSpy).toHaveBeenCalledWith({ id: 'r2', kind: 'related' });
  });

  it('disables up on the first related row and down on the last related row', () => {
    component.relationshipsRelated = [makeItem({ id: 'r1' }), makeItem({ id: 'r2' })];
    fixture.detectChanges();
    const columns = fixture.debugElement.queryAll(By.css('.grid.gap-4 > div'));
    const relatedRows = columns[0].queryAll(By.css('.flex.items-center.justify-between'));
    const firstButtons = relatedRows[0].queryAll(By.css('app-button'));
    const lastButtons = relatedRows[1].queryAll(By.css('app-button'));
    expect(firstButtons[0].componentInstance.disabled).toBe(true); // up disabled at index 0
    expect(lastButtons[1].componentInstance.disabled).toBe(true); // down disabled at last index
  });

  it('emits move and remove for an upsell item with the upsell kind', () => {
    component.relationshipsUpsells = [
      makeItem({ id: 'u1', name: 'Up A' }),
      makeItem({ id: 'u2', name: 'Up B' }),
    ];
    const moveSpy = jasmine.createSpy('move');
    const removeSpy = jasmine.createSpy('remove');
    component.moveRequested.subscribe(moveSpy);
    component.removeRequested.subscribe(removeSpy);
    fixture.detectChanges();

    const columns = fixture.debugElement.queryAll(By.css('.grid.gap-4 > div'));
    const upsellRows = columns[1].queryAll(By.css('.flex.items-center.justify-between'));
    const firstRowButtons = upsellRows[0].queryAll(By.css('app-button'));
    firstRowButtons[1].componentInstance.action.emit(); // down (up disabled at index 0)
    firstRowButtons[2].componentInstance.action.emit(); // remove

    expect(moveSpy).toHaveBeenCalledWith({ kind: 'upsell', index: 0, direction: 1 });
    expect(removeSpy).toHaveBeenCalledWith({ id: 'u1', kind: 'upsell' });
  });

  it('disables move/remove buttons for relationship rows while saving', () => {
    component.relationshipsRelated = [makeItem({ id: 'r1' }), makeItem({ id: 'r2' })];
    component.relationshipsSaving = true;
    fixture.detectChanges();
    const columns = fixture.debugElement.queryAll(By.css('.grid.gap-4 > div'));
    const relatedRows = columns[0].queryAll(By.css('.flex.items-center.justify-between'));
    const buttons = relatedRows[0].queryAll(By.css('app-button'));
    // Remove is always gated by saving; it should be disabled here.
    expect(buttons[2].componentInstance.disabled).toBe(true);
  });

  it('emits saveRequested when the save button is actioned and slug is editing', () => {
    component.hasEditingSlug = true;
    const saveSpy = jasmine.createSpy('save');
    component.saveRequested.subscribe(saveSpy);
    fixture.detectChanges();
    const saveButton = fixture.debugElement.queryAll(By.css('.justify-end app-button'))[0];
    expect(saveButton.componentInstance.disabled).toBe(false);
    saveButton.componentInstance.action.emit();
    expect(saveSpy).toHaveBeenCalled();
  });

  it('disables the save button when no slug is being edited', () => {
    component.hasEditingSlug = false;
    fixture.detectChanges();
    const saveButton = fixture.debugElement.queryAll(By.css('.justify-end app-button'))[0];
    expect(saveButton.componentInstance.disabled).toBe(true);
  });

  it('disables the save button while saving even when a slug is being edited', () => {
    component.hasEditingSlug = true;
    component.relationshipsSaving = true;
    fixture.detectChanges();
    const saveButton = fixture.debugElement.queryAll(By.css('.justify-end app-button'))[0];
    expect(saveButton.componentInstance.disabled).toBe(true);
  });
});
