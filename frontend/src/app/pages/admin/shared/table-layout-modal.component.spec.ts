import { SimpleChange, SimpleChanges } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import {
  AdminTableLayoutColumnDef,
  TableLayoutModalComponent,
} from './table-layout-modal.component';
import { AdminTableLayoutV1 } from './admin-table-layout';

const COLUMNS: AdminTableLayoutColumnDef[] = [
  { id: 'name', labelKey: 'col.name', required: true },
  { id: 'email', labelKey: 'col.email' },
  { id: 'role', labelKey: '' }, // empty labelKey exercises the labelKey() fallback to id
];

function change(previous: unknown, current: unknown, firstChange = false): SimpleChange {
  return new SimpleChange(previous, current, firstChange);
}

describe('TableLayoutModalComponent', () => {
  describe('rendered DOM behaviour', () => {
    let fixture: ComponentFixture<TableLayoutModalComponent>;
    let component: TableLayoutModalComponent;

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [TranslateModule.forRoot(), TableLayoutModalComponent],
      });
      fixture = TestBed.createComponent(TableLayoutModalComponent);
      component = fixture.componentInstance;
      component.columns = COLUMNS;
      component.open = true;
      // Drive ngOnChanges the way Angular would on first bind.
      component.ngOnChanges({
        open: change(undefined, true, true),
        columns: change(undefined, COLUMNS, true),
      } as SimpleChanges);
      fixture.detectChanges();
    });

    it('renders one row per column with a density select', () => {
      const root = fixture.nativeElement as HTMLElement;
      const checkboxes = root.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBe(COLUMNS.length);
      expect(root.querySelector('select')).not.toBeNull();
    });

    it('marks required columns as checked and disabled', () => {
      const root = fixture.nativeElement as HTMLElement;
      const firstCheckbox = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
      // 'name' is required: visible (checked) and not toggleable (disabled).
      expect(firstCheckbox.checked).toBeTrue();
      expect(firstCheckbox.disabled).toBeTrue();
    });

    it('emits closed when the modal close output fires', () => {
      const closedSpy = jasmine.createSpy('closed');
      component.closed.subscribe(closedSpy);
      const modal = fixture.nativeElement.querySelector('app-modal');
      modal.dispatchEvent(new Event('closed'));
      // app-modal (closed) binding maps to component output; emit directly to be runner-agnostic.
      component.closed.emit();
      expect(closedSpy).toHaveBeenCalled();
    });
  });

  describe('ngOnChanges', () => {
    let component: TableLayoutModalComponent;

    beforeEach(() => {
      component = new TableLayoutModalComponent();
      component.columns = COLUMNS;
    });

    it('resets the draft when open is true and the open input changed', () => {
      component.open = true;
      component.ngOnChanges({ open: change(false, true) } as SimpleChanges);
      expect(component.draftOrder).toEqual(['name', 'email', 'role']);
      expect(component.draftDensity).toBe('comfortable');
    });

    it('does not reset the draft when open is false', () => {
      component.open = false;
      component.ngOnChanges({ open: change(true, false) } as SimpleChanges);
      expect(component.draftOrder).toEqual([]);
    });

    it('reacts to a columns-only change (first operand false, second true)', () => {
      component.open = true;
      component.ngOnChanges({ columns: change(undefined, COLUMNS) } as SimpleChanges);
      expect(component.draftOrder).toEqual(['name', 'email', 'role']);
    });

    it('reacts to a layout-only change', () => {
      component.open = true;
      component.layout = {
        version: 1,
        order: ['email', 'name', 'role'],
        hidden: ['email'],
        density: 'compact',
      };
      component.ngOnChanges({ layout: change(null, component.layout) } as SimpleChanges);
      expect(component.draftOrder).toEqual(['email', 'name', 'role']);
      expect(component.draftDensity).toBe('compact');
      expect(component.draftHidden.has('email')).toBeTrue();
    });

    it('reacts to a defaults-only change', () => {
      component.open = true;
      component.defaults = {
        version: 1,
        order: ['role', 'email', 'name'],
        hidden: [],
        density: 'comfortable',
      };
      component.ngOnChanges({ defaults: change(null, component.defaults) } as SimpleChanges);
      expect(component.draftOrder).toEqual(['role', 'email', 'name']);
    });

    it('ignores changes that do not touch any tracked input', () => {
      component.open = true;
      component.ngOnChanges({ somethingElse: change(1, 2) } as SimpleChanges);
      expect(component.draftOrder).toEqual([]);
    });
  });

  describe('resetToDefaults', () => {
    it('uses the provided defaults when present', () => {
      const component = new TableLayoutModalComponent();
      component.columns = COLUMNS;
      component.defaults = {
        version: 1,
        order: ['email', 'name', 'role'],
        hidden: ['role'],
        density: 'compact',
      };
      component.resetToDefaults();
      expect(component.draftOrder).toEqual(['email', 'name', 'role']);
      expect(component.draftHidden.has('role')).toBeTrue();
      expect(component.draftDensity).toBe('compact');
    });

    it('falls back to the column-derived default layout when defaults is null', () => {
      const component = new TableLayoutModalComponent();
      component.columns = COLUMNS;
      component.defaults = null;
      component.resetToDefaults();
      expect(component.draftOrder).toEqual(['name', 'email', 'role']);
      expect(component.draftHidden.size).toBe(0);
      expect(component.draftDensity).toBe('comfortable');
    });
  });

  describe('toggleColumn', () => {
    let component: TableLayoutModalComponent;

    beforeEach(() => {
      component = new TableLayoutModalComponent();
      component.columns = COLUMNS;
    });

    it('is a no-op for required columns', () => {
      component.toggleColumn('name');
      expect(component.draftHidden.has('name')).toBeFalse();
    });

    it('hides then re-shows a non-required column', () => {
      component.toggleColumn('email');
      expect(component.draftHidden.has('email')).toBeTrue();
      component.toggleColumn('email');
      expect(component.draftHidden.has('email')).toBeFalse();
    });
  });

  describe('move', () => {
    let component: TableLayoutModalComponent;

    beforeEach(() => {
      component = new TableLayoutModalComponent();
      component.columns = COLUMNS;
      component.draftOrder = ['name', 'email', 'role'];
    });

    it('moves an item down by swapping with its successor', () => {
      component.move(0, 1);
      expect(component.draftOrder).toEqual(['email', 'name', 'role']);
    });

    it('does nothing when moving the first item up (target index < 0)', () => {
      component.move(0, -1);
      expect(component.draftOrder).toEqual(['name', 'email', 'role']);
    });

    it('does nothing when moving the last item down (target index >= length)', () => {
      component.move(2, 1);
      expect(component.draftOrder).toEqual(['name', 'email', 'role']);
    });
  });

  describe('applyDraft', () => {
    it('emits the sanitized layout with an updated_at timestamp, then closes', () => {
      const component = new TableLayoutModalComponent();
      component.columns = COLUMNS;
      component.draftOrder = ['role', 'email', 'name'];
      component.draftHidden = new Set<string>(['email']);
      component.draftDensity = 'compact';

      let applied: AdminTableLayoutV1 | undefined;
      const closedSpy = jasmine.createSpy('closed');
      component.applied.subscribe((v) => (applied = v));
      component.closed.subscribe(closedSpy);

      component.applyDraft();

      expect(applied).toBeDefined();
      expect(applied?.version).toBe(1);
      expect(applied?.order).toEqual(['role', 'email', 'name']);
      expect(applied?.hidden).toEqual(['email']);
      expect(applied?.density).toBe('compact');
      expect(typeof applied?.updated_at).toBe('string');
      expect(closedSpy).toHaveBeenCalled();
    });
  });

  describe('isRequired', () => {
    let component: TableLayoutModalComponent;

    beforeEach(() => {
      component = new TableLayoutModalComponent();
      component.columns = COLUMNS;
    });

    it('returns true for a column flagged required', () => {
      expect(component.isRequired('name')).toBeTrue();
    });

    it('returns false for a known non-required column', () => {
      expect(component.isRequired('email')).toBeFalse();
    });

    it('returns false for an unknown column id', () => {
      expect(component.isRequired('missing')).toBeFalse();
    });
  });

  describe('labelKey', () => {
    let component: TableLayoutModalComponent;

    beforeEach(() => {
      component = new TableLayoutModalComponent();
      component.columns = COLUMNS;
    });

    it('returns the configured labelKey when present', () => {
      expect(component.labelKey('email')).toBe('col.email');
    });

    it('falls back to the id when the labelKey is empty', () => {
      expect(component.labelKey('role')).toBe('role');
    });

    it('falls back to the id when the column is unknown', () => {
      expect(component.labelKey('missing')).toBe('missing');
    });
  });

  describe('resetDraft (via ngOnChanges) source selection', () => {
    let component: TableLayoutModalComponent;

    beforeEach(() => {
      component = new TableLayoutModalComponent();
      component.columns = COLUMNS;
      component.open = true;
    });

    it('prefers layout when a layout is set', () => {
      component.layout = {
        version: 1,
        order: ['role', 'name', 'email'],
        hidden: [],
        density: 'compact',
      };
      component.defaults = {
        version: 1,
        order: ['name', 'email', 'role'],
        hidden: [],
        density: 'comfortable',
      };
      component.ngOnChanges({ open: change(false, true) } as SimpleChanges);
      expect(component.draftOrder).toEqual(['role', 'name', 'email']);
      expect(component.draftDensity).toBe('compact');
    });

    it('uses defaults when layout is null but defaults is set', () => {
      component.layout = null;
      component.defaults = {
        version: 1,
        order: ['email', 'role', 'name'],
        hidden: ['role'],
        density: 'comfortable',
      };
      component.ngOnChanges({ open: change(false, true) } as SimpleChanges);
      expect(component.draftOrder).toEqual(['email', 'role', 'name']);
      expect(component.draftHidden.has('role')).toBeTrue();
    });

    it('falls back to the default layout when both layout and defaults are null', () => {
      component.layout = null;
      component.defaults = null;
      component.ngOnChanges({ open: change(false, true) } as SimpleChanges);
      expect(component.draftOrder).toEqual(['name', 'email', 'role']);
      expect(component.draftHidden.size).toBe(0);
    });
  });
});
