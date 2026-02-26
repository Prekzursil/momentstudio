import { AdminOrdersComponent } from './admin-orders.component';

function createComponentHarness(userId = 'admin-user'): any {
  const component = Object.create(AdminOrdersComponent.prototype);
  component.auth = {
    user: () => ({ id: userId })
  };
  return component;
}

describe('AdminOrdersComponent preset coercion and loading', () => {
  it('coercePreset applies safe defaults when filters are null', () => {
    const component = createComponentHarness();

    const preset = component.coercePreset({
      id: 'preset-1',
      name: 'Null filters',
      createdAt: undefined,
      filters: null
    });

    expect(preset).toEqual({
      id: 'preset-1',
      name: 'Null filters',
      createdAt: '',
      filters: {
        q: '',
        status: 'all',
        sla: 'all',
        fraud: 'all',
        tag: '',
        fromDate: '',
        toDate: '',
        includeTestOrders: true,
        limit: 20
      }
    });
  });

  it('coercePreset normalizes malformed filter primitives', () => {
    const component = createComponentHarness();

    const preset = component.coercePreset({
      id: 'preset-2',
      name: 'Malformed filters',
      createdAt: 1700000000,
      filters: {
        q: 42,
        status: 'pending',
        sla: 'invalid',
        fraud: 'invalid',
        tag: 100,
        fromDate: null,
        toDate: undefined,
        includeTestOrders: 'yes',
        limit: '100'
      }
    });

    expect(preset.createdAt).toBe('1700000000');
    expect(preset.filters.q).toBe('42');
    expect(preset.filters.sla).toBe('all');
    expect(preset.filters.fraud).toBe('all');
    expect(preset.filters.tag).toBe('100');
    expect(preset.filters.fromDate).toBe('');
    expect(preset.filters.toDate).toBe('');
    expect(preset.filters.includeTestOrders).toBeTrue();
    expect(preset.filters.limit).toBe(20);
  });

  it('loadPresets returns [] when localStorage has no saved value', () => {
    const component = createComponentHarness('admin-1');
    const getItemSpy = spyOn(localStorage, 'getItem').and.returnValue(null);

    const presets = component.loadPresets();

    expect(getItemSpy).toHaveBeenCalledWith('admin.orders.filters.v1:admin-1');
    expect(presets).toEqual([]);
  });

  it('loadPresets returns [] for malformed localStorage JSON payloads', () => {
    const component = createComponentHarness();
    spyOn(localStorage, 'getItem').and.returnValue('{not-valid-json');

    expect(component.loadPresets()).toEqual([]);
  });

  it('loadPresets returns [] when localStorage payload is not an array', () => {
    const component = createComponentHarness();
    spyOn(localStorage, 'getItem').and.returnValue(JSON.stringify({ id: 'preset-1' }));

    expect(component.loadPresets()).toEqual([]);
  });

  it('loadPresets filters malformed entries and coerces valid ones', () => {
    const component = createComponentHarness();
    spyOn(localStorage, 'getItem').and.returnValue(
      JSON.stringify([
        null,
        { id: 'missing-name' },
        { name: 'missing-id' },
        {
          id: 'preset-valid',
          name: 'Valid preset',
          filters: {
            q: 7,
            sla: 'not-real',
            fraud: 'queue',
            includeTestOrders: 'false',
            limit: Number.NaN
          }
        }
      ])
    );

    const presets = component.loadPresets();

    expect(presets.length).toBe(1);
    expect(presets[0]).toEqual({
      id: 'preset-valid',
      name: 'Valid preset',
      createdAt: '',
      filters: {
        q: '7',
        status: 'all',
        sla: 'all',
        fraud: 'queue',
        tag: '',
        fromDate: '',
        toDate: '',
        includeTestOrders: true,
        limit: 20
      }
    });
  });

  it('applyKanbanResult writes empty defaults when response is null', () => {
    const component = createComponentHarness();
    const itemsByStatus: Record<string, any[]> = {};
    const totalsByStatus: Record<string, number> = {};

    component.applyKanbanResult({ status: 'pending', res: null }, itemsByStatus, totalsByStatus);

    expect(itemsByStatus['pending']).toEqual([]);
    expect(totalsByStatus['pending']).toBe(0);
  });

  it('collectKanbanFirstError captures first error and keeps kanban buckets consistent', () => {
    const component = createComponentHarness();
    const itemsByStatus: Record<string, any[]> = {};
    const totalsByStatus: Record<string, number> = {};
    const firstNetworkError = new Error('failed');
    const successfulResponse: any = {
      items: [{ id: 'order-1' }],
      meta: { total_items: 1 }
    };

    const firstError = component.collectKanbanFirstError(
      [
        { status: 'paid', res: successfulResponse },
        { status: 'cancelled', res: null, err: firstNetworkError },
        { status: 'failed', res: null, err: new Error('second') }
      ],
      itemsByStatus,
      totalsByStatus
    );

    expect(firstError).toBe(firstNetworkError);
    expect(itemsByStatus['paid']).toEqual(successfulResponse.items);
    expect(totalsByStatus['paid']).toBe(1);
    expect(itemsByStatus['cancelled']).toEqual([]);
    expect(totalsByStatus['cancelled']).toBe(0);
    expect(itemsByStatus['failed']).toEqual([]);
    expect(totalsByStatus['failed']).toBe(0);
  });
});
