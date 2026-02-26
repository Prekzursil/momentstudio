import { of, throwError } from 'rxjs';

import { AdminFavoritesService } from './admin-favorites.service';

describe('AdminFavoritesService', () => {
  function createService() {
    const api = jasmine.createSpyObj('ApiService', ['get', 'put']);
    const toast = jasmine.createSpyObj('ToastService', ['error']);
    const translate = { instant: (key: string) => key } as any;
    const service = new AdminFavoritesService(api as any, toast as any, translate);
    return { service, api, toast };
  }

  function favorite(key: string) {
    return {
      key,
      type: 'filter' as const,
      label: `Label ${key}`,
      subtitle: `Subtitle ${key}`,
      url: `/admin/${key}`,
      state: null as Record<string, any> | null,
    };
  }

  it('initializes only once and loads favorites', () => {
    const { service, api } = createService();
    api.get.and.returnValue(of({ items: [favorite('a')] }));

    service.init();
    service.init();

    expect(api.get.calls.count()).toBe(1);
    expect(service.items().map((it) => it.key)).toEqual(['a']);
    expect(service.loading()).toBeFalse();
    expect(service.error()).toBeNull();
  });

  it('sets load error when refresh fails', () => {
    const { service, api } = createService();
    api.get.and.returnValue(throwError(() => new Error('boom')));

    service.refresh();

    expect(service.loading()).toBeFalse();
    expect(service.error()).toBe('adminUi.favorites.errors.load');
  });

  it('adds and trims favorites using optimistic save', () => {
    const { service, api } = createService();
    api.put.and.callFake((_url: string, body: any) => of({ items: body.items }));

    for (let i = 0; i < 52; i += 1) {
      service.add(favorite(`k-${i}`));
    }

    expect(service.items().length).toBe(50);
    expect(service.items()[0].key).toBe('k-51');
    expect(api.put).toHaveBeenCalled();
  });

  it('removes favorites and reverts state when save fails', () => {
    const { service, api, toast } = createService();
    const initial = [favorite('a'), favorite('b')];
    service.items.set(initial);
    api.put.and.returnValue(throwError(() => new Error('fail')));

    service.remove('a');

    expect(service.items()).toEqual(initial);
    expect(toast.error).toHaveBeenCalledWith('adminUi.favorites.errors.save');
    expect(service.loading()).toBeFalse();
  });

  it('supports favorite checks, toggle and clear helpers', () => {
    const { service, api } = createService();
    api.put.and.callFake((_url: string, body: any) => of({ items: body.items }));

    const item = favorite('f-1');
    expect(service.isFavorite(' f-1 ')).toBeFalse();
    service.toggle(item);
    expect(service.isFavorite('f-1')).toBeTrue();
    service.toggle(item);
    expect(service.isFavorite('f-1')).toBeFalse();

    service.items.set([favorite('x')]);
    service.clear();
    expect(service.items()).toEqual([]);
  });
});

