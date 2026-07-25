import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { AdminProductsBulkActionsComponent } from './admin-products-bulk-actions.component';

const TRANSLATIONS = {
  adminUi: {
    status: { draft: 'Draft', published: 'Published', archived: 'Archived' },
    products: {
      sale: { type: 'Sale type', typePercent: 'Percent', typeAmount: 'Amount' },
      table: { status: 'Status target' },
      bulk: {
        selected: 'Selected {{count}}',
        clearSelection: 'Clear selection',
        saleValue: 'Sale value',
        applySale: 'Apply sale',
        clearSale: 'Clear sale',
        note: 'Bulk note',
        status: { apply: 'Apply status' },
        category: {
          label: 'Category label',
          placeholder: 'Choose category',
          apply: 'Apply category',
          addAndApply: 'Add and apply category',
        },
        schedule: {
          publishAt: 'Publish at',
          unpublishAt: 'Unpublish at',
          apply: 'Apply schedule',
          clearPublish: 'Clear publish',
          clearUnpublish: 'Clear unpublish',
        },
        priceAdjust: {
          mode: 'Price mode',
          modePercent: 'Price percent',
          modeAmount: 'Price amount',
          direction: 'Price direction',
          directionIncrease: 'Increase',
          directionDecrease: 'Decrease',
          value: 'Price value',
          apply: 'Apply price',
          preview: '{{old_min}}-{{old_max}} to {{new_min}}-{{new_max}} {{currency}}',
        },
      },
    },
  },
};

describe('AdminProductsBulkActionsComponent', () => {
  let fixture: ComponentFixture<AdminProductsBulkActionsComponent>;
  let component: AdminProductsBulkActionsComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AdminProductsBulkActionsComponent],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', TRANSLATIONS, true);
    translate.use('en');

    fixture = TestBed.createComponent(AdminProductsBulkActionsComponent);
    component = fixture.componentInstance;
  });

  /** Click the native <button> rendered by the app-button with the given label. */
  function clickButton(label: string): void {
    const button = fixture.debugElement
      .queryAll(By.directive(ButtonComponent))
      .find((de) => (de.componentInstance as ButtonComponent).label === label);
    if (!button) {
      throw new Error(`No app-button with label "${label}"`);
    }
    button.query(By.css('button')).nativeElement.dispatchEvent(new MouseEvent('click'));
  }

  /** Find the native <select> inside the <label> whose text contains labelText. */
  function selectByLabel(labelText: string): HTMLSelectElement {
    const label = fixture.debugElement
      .queryAll(By.css('label'))
      .find((de) => (de.nativeElement as HTMLElement).textContent?.includes(labelText));
    if (!label) {
      throw new Error(`No <label> containing "${labelText}"`);
    }
    return label.query(By.css('select')).nativeElement as HTMLSelectElement;
  }

  /** Find the native datetime-local <input> inside the <label> with labelText. */
  function dateInputByLabel(labelText: string): HTMLInputElement {
    const label = fixture.debugElement
      .queryAll(By.css('label'))
      .find((de) => (de.nativeElement as HTMLElement).textContent?.includes(labelText));
    if (!label) {
      throw new Error(`No <label> containing "${labelText}"`);
    }
    return label.query(By.css('input')).nativeElement as HTMLInputElement;
  }

  /** Get the app-input InputComponent instance by its label input. */
  function inputByLabel(label: string): InputComponent {
    const found = fixture.debugElement
      .queryAll(By.directive(InputComponent))
      .find((de) => (de.componentInstance as InputComponent).label === label);
    if (!found) {
      throw new Error(`No app-input with label "${label}"`);
    }
    return found.componentInstance as InputComponent;
  }

  function changeSelect(select: HTMLSelectElement, index: number): void {
    select.selectedIndex = index;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('creates with the documented input defaults', () => {
    fixture.detectChanges();
    expect(component.selectedCount).toBe(0);
    expect(component.disabled).toBeFalse();
    expect(component.categories).toEqual([]);
    expect(component.bulkSaleType).toBe('percent');
    expect(component.bulkStatusTarget).toBe('published');
    expect(component.bulkPriceMode).toBe('percent');
    expect(component.bulkPriceDirection).toBe('increase');
    expect(component.bulkPricePreview).toBeNull();
    expect(component.bulkError).toBeNull();
  });

  it('renders the selected count using translation interpolation', () => {
    component.selectedCount = 4;
    fixture.detectChanges();
    const heading = fixture.debugElement.query(By.css('p')).nativeElement as HTMLElement;
    expect(heading.textContent?.trim()).toBe('Selected 4');
  });

  it('emits clearSelection when the clear-selection button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('clearSelection');
    component.clearSelection.subscribe(spy);
    clickButton('Clear selection');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits applySale when the apply-sale button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('applySale');
    component.applySale.subscribe(spy);
    clickButton('Apply sale');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits clearSale when the clear-sale button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('clearSale');
    component.clearSale.subscribe(spy);
    clickButton('Clear sale');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits applyStatus when the apply-status button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('applyStatus');
    component.applyStatus.subscribe(spy);
    clickButton('Apply status');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits applyCategory when the apply-category button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('applyCategory');
    component.applyCategory.subscribe(spy);
    clickButton('Apply category');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits addAndApplyCategory when the add-and-apply button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('addAndApplyCategory');
    component.addAndApplyCategory.subscribe(spy);
    clickButton('Add and apply category');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits applySchedule when the apply-schedule button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('applySchedule');
    component.applySchedule.subscribe(spy);
    clickButton('Apply schedule');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits clearPublishSchedule when the clear-publish button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('clearPublishSchedule');
    component.clearPublishSchedule.subscribe(spy);
    clickButton('Clear publish');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits clearUnpublishSchedule when the clear-unpublish button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('clearUnpublishSchedule');
    component.clearUnpublishSchedule.subscribe(spy);
    clickButton('Clear unpublish');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits applyPriceAdjustment when the apply-price button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('applyPriceAdjustment');
    component.applyPriceAdjustment.subscribe(spy);
    clickButton('Apply price');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits bulkSaleTypeChange when the sale-type select changes', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('bulkSaleTypeChange');
    component.bulkSaleTypeChange.subscribe(spy);
    // options: [0] percent (default), [1] amount
    changeSelect(selectByLabel('Sale type'), 1);
    expect(spy).toHaveBeenCalledWith('amount');
  });

  it('emits bulkStatusTargetChange when the status select changes', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('bulkStatusTargetChange');
    component.bulkStatusTargetChange.subscribe(spy);
    // options: [0] draft, [1] published (default), [2] archived
    changeSelect(selectByLabel('Status target'), 0);
    expect(spy).toHaveBeenCalledWith('draft');
  });

  it('emits bulkCategoryIdChange when the category select changes', () => {
    component.categories = [
      { id: 'c1', name: 'Cat One' },
      { id: 'c2', name: 'Cat Two' },
    ];
    fixture.detectChanges();
    const spy = jasmine.createSpy('bulkCategoryIdChange');
    component.bulkCategoryIdChange.subscribe(spy);
    // options: [0] placeholder (''), [1] c1, [2] c2
    changeSelect(selectByLabel('Category label'), 2);
    expect(spy).toHaveBeenCalledWith('c2');
  });

  it('renders one category option per category plus the placeholder', () => {
    component.categories = [
      { id: 'c1', name: 'Cat One' },
      { id: 'c2', name: 'Cat Two' },
    ];
    fixture.detectChanges();
    const options = selectByLabel('Category label').querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[0].textContent?.trim()).toBe('Choose category');
    expect(options[1].textContent?.trim()).toBe('Cat One');
    expect(options[2].textContent?.trim()).toBe('Cat Two');
  });

  it('emits bulkPriceModeChange when the price-mode select changes', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('bulkPriceModeChange');
    component.bulkPriceModeChange.subscribe(spy);
    changeSelect(selectByLabel('Price mode'), 1);
    expect(spy).toHaveBeenCalledWith('amount');
  });

  it('emits bulkPriceDirectionChange when the price-direction select changes', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('bulkPriceDirectionChange');
    component.bulkPriceDirectionChange.subscribe(spy);
    changeSelect(selectByLabel('Price direction'), 1);
    expect(spy).toHaveBeenCalledWith('decrease');
  });

  it('emits bulkPublishScheduledForChange when the publish-at input changes', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('bulkPublishScheduledForChange');
    component.bulkPublishScheduledForChange.subscribe(spy);
    const input = dateInputByLabel('Publish at');
    input.value = '2026-01-02T10:30';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledWith('2026-01-02T10:30');
  });

  it('emits bulkUnpublishScheduledForChange when the unpublish-at input changes', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('bulkUnpublishScheduledForChange');
    component.bulkUnpublishScheduledForChange.subscribe(spy);
    const input = dateInputByLabel('Unpublish at');
    input.value = '2026-02-03T08:15';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledWith('2026-02-03T08:15');
  });

  it('emits bulkSaleValueChange when the sale-value input emits valueChange', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('bulkSaleValueChange');
    component.bulkSaleValueChange.subscribe(spy);
    inputByLabel('Sale value').valueChange.emit('15');
    expect(spy).toHaveBeenCalledWith('15');
  });

  it('emits bulkPriceValueChange when the price-value input emits valueChange', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('bulkPriceValueChange');
    component.bulkPriceValueChange.subscribe(spy);
    inputByLabel('Price value').valueChange.emit('7.50');
    expect(spy).toHaveBeenCalledWith('7.50');
  });

  it('uses the percent placeholders by default for sale and price inputs', () => {
    fixture.detectChanges();
    expect(inputByLabel('Sale value').placeholder).toBe('10');
    expect(inputByLabel('Price value').placeholder).toBe('10');
  });

  it('uses the amount placeholders when sale and price modes are amount', () => {
    component.bulkSaleType = 'amount';
    component.bulkPriceMode = 'amount';
    fixture.detectChanges();
    expect(inputByLabel('Sale value').placeholder).toBe('5.00');
    expect(inputByLabel('Price value').placeholder).toBe('5.00');
  });

  it('hides the price preview when bulkPricePreview is null', () => {
    fixture.detectChanges();
    const preview = fixture.debugElement
      .queryAll(By.css('p'))
      .find((de) => (de.nativeElement as HTMLElement).textContent?.includes('to'));
    expect(preview).toBeUndefined();
  });

  it('renders the interpolated price preview when bulkPricePreview is provided', () => {
    component.bulkPricePreview = {
      old_min: '10',
      old_max: '20',
      new_min: '12',
      new_max: '24',
      currency: 'RON',
    };
    fixture.detectChanges();
    const preview = fixture.debugElement
      .queryAll(By.css('p'))
      .map((de) => (de.nativeElement as HTMLElement).textContent?.trim())
      .find((text) => text?.includes('RON'));
    expect(preview).toBe('10-20 to 12-24 RON');
  });

  it('hides the error banner when bulkError is null', () => {
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.bg-rose-50'))).toBeNull();
  });

  it('renders the error banner with the error text when bulkError is set', () => {
    component.bulkError = 'Something failed';
    fixture.detectChanges();
    const banner = fixture.debugElement.query(By.css('.bg-rose-50')).nativeElement as HTMLElement;
    expect(banner.textContent?.trim()).toBe('Something failed');
  });

  it('does not disable child buttons or inputs by default', () => {
    fixture.detectChanges();
    const buttons = fixture.debugElement.queryAll(By.directive(ButtonComponent));
    const inputs = fixture.debugElement.queryAll(By.directive(InputComponent));
    expect(buttons.length).toBe(10);
    expect(inputs.length).toBe(2);
    expect(buttons.every((de) => !(de.componentInstance as ButtonComponent).disabled)).toBeTrue();
    expect(inputs.every((de) => !(de.componentInstance as InputComponent).disabled)).toBeTrue();
    // Native buttons rendered enabled too.
    const nativeButton = fixture.debugElement.query(By.css('button'))
      .nativeElement as HTMLButtonElement;
    expect(nativeButton.disabled).toBeFalse();
  });

  it('propagates the disabled state to every child button and input', () => {
    component.disabled = true;
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(By.directive(ButtonComponent));
    const inputs = fixture.debugElement.queryAll(By.directive(InputComponent));
    expect(buttons.length).toBe(10);
    expect(inputs.length).toBe(2);
    expect(buttons.every((de) => (de.componentInstance as ButtonComponent).disabled)).toBeTrue();
    expect(inputs.every((de) => (de.componentInstance as InputComponent).disabled)).toBeTrue();
    // The rendered native buttons reflect the disabled state.
    const nativeButton = fixture.debugElement.query(By.css('button'))
      .nativeElement as HTMLButtonElement;
    expect(nativeButton.disabled).toBeTrue();
  });
});
