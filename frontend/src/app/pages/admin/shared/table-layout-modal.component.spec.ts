import { TableLayoutModalComponent } from './table-layout-modal.component';

function createTableLayoutModalComponent(): TableLayoutModalComponent {
  const component = new TableLayoutModalComponent();
  component.columns = [
    { id: 'id', labelKey: 'table.id', required: true },
    { id: 'name', labelKey: 'table.name' },
    { id: 'status', labelKey: 'table.status' }
  ] as any;
  component.layout = {
    version: 1,
    order: ['name', 'id', 'status'],
    hidden: ['status'],
    density: 'compact'
  } as any;
  component.defaults = {
    version: 1,
    order: ['id', 'name', 'status'],
    hidden: [],
    density: 'comfortable'
  } as any;
  return component;
}

describe('TableLayoutModalComponent', () => {
  it('resets draft when modal opens via ngOnChanges', () => {
    const component = createTableLayoutModalComponent();
    component.open = true;

    component.ngOnChanges({ open: { currentValue: true, previousValue: false, firstChange: false, isFirstChange: () => false } as any });

    expect(component.draftOrder).toEqual(['name', 'id', 'status']);
    expect(component.draftHidden.has('status')).toBeTrue();
    expect(component.draftDensity).toBe('compact');
  });

  it('restores defaults and toggles optional columns', () => {
    const component = createTableLayoutModalComponent();
    component.resetToDefaults();

    expect(component.draftOrder).toEqual(['id', 'name', 'status']);
    expect(component.draftHidden.size).toBe(0);
    expect(component.draftDensity).toBe('comfortable');

    component.toggleColumn('id');
    expect(component.draftHidden.has('id')).toBeFalse();

    component.toggleColumn('name');
    expect(component.draftHidden.has('name')).toBeTrue();
    component.toggleColumn('name');
    expect(component.draftHidden.has('name')).toBeFalse();
  });

  it('moves columns within bounds and ignores invalid moves', () => {
    const component = createTableLayoutModalComponent();
    component.draftOrder = ['id', 'name', 'status'];

    component.move(1, 1);
    expect(component.draftOrder).toEqual(['id', 'status', 'name']);

    component.move(0, -1);
    expect(component.draftOrder).toEqual(['id', 'status', 'name']);

    component.move(2, 1);
    expect(component.draftOrder).toEqual(['id', 'status', 'name']);
  });

  it('applies sanitized draft and emits close', () => {
    const component = createTableLayoutModalComponent();
    component.draftOrder = ['status', 'id', 'name'];
    component.draftHidden = new Set(['name']);
    component.draftDensity = 'compact';

    const appliedSpy = spyOn(component.applied, 'emit');
    const closedSpy = spyOn(component.closed, 'emit');

    component.applyDraft();

    expect(appliedSpy).toHaveBeenCalled();
    const payload = appliedSpy.calls.mostRecent().args[0] as any;
    expect(payload.version).toBe(1);
    expect(Array.isArray(payload.order)).toBeTrue();
    expect(payload.updated_at).toEqual(jasmine.any(String));
    expect(closedSpy).toHaveBeenCalled();
  });

  it('reports required and label values for columns', () => {
    const component = createTableLayoutModalComponent();

    expect(component.isRequired('id')).toBeTrue();
    expect(component.isRequired('missing')).toBeFalse();
    expect(component.labelKey('name')).toBe('table.name');
    expect(component.labelKey('missing')).toBe('missing');
  });
});
