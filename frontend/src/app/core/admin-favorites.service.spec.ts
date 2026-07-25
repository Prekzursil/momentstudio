import { of, throwError } from 'rxjs';

import { AdminFavoritesService, AdminFavoriteItem } from './admin-favorites.service';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';

import type { TranslateService } from '@ngx-translate/core';

type ApiSpy = jasmine.SpyObj<Pick<ApiService, 'get' | 'put'>>;
type ToastSpy = jasmine.SpyObj<Pick<ToastService, 'error'>>;
type TranslateSpy = jasmine.SpyObj<Pick<TranslateService, 'instant'>>;
type FavoritesBody = { items: AdminFavoriteItem[] };

function makeItem(overrides: Partial<AdminFavoriteItem> = {}): AdminFavoriteItem {
  return {
    key: 'k1',
    type: 'page',
    label: 'Label 1',
    subtitle: 'Subtitle 1',
    url: '/admin/page',
    state: { tab: 'a' },
    ...overrides,
  };
}

describe('AdminFavoritesService', () => {
  let api: ApiSpy;
  let toast: ToastSpy;
  let translate: TranslateSpy;
  let service: AdminFavoritesService;

  function lastSent(): FavoritesBody {
    return api.put.calls.mostRecent().args[1] as FavoritesBody;
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<Pick<ApiService, 'get' | 'put'>>('ApiService', ['get', 'put']);
    toast = jasmine.createSpyObj<Pick<ToastService, 'error'>>('ToastService', ['error']);
    translate = jasmine.createSpyObj<Pick<TranslateService, 'instant'>>('TranslateService', [
      'instant',
    ]);
    // Default: translation key is not found, so instant echoes the key back.
    translate.instant.and.callFake((key: string | string[]) => key);
    // Default: the backend persists and echoes back exactly what it was sent,
    // mirroring the real PUT /admin/ui/favorites contract so optimistic state
    // survives across successive add/remove calls.
    api.put.and.callFake(((_path: string, body: FavoritesBody) => of(body)) as never);

    service = new AdminFavoritesService(
      api as unknown as ApiService,
      toast as unknown as ToastService,
      translate as unknown as TranslateService,
    );
  });

  describe('init', () => {
    it('refreshes once and loads favorites on first call', () => {
      api.get.and.returnValue(of({ items: [makeItem()] }));

      service.init();

      expect(api.get).toHaveBeenCalledOnceWith('/admin/ui/favorites');
      expect(service.items().length).toBe(1);
      expect(service.loading()).toBe(false);
    });

    it('does not refresh again on subsequent calls', () => {
      api.get.and.returnValue(of({ items: [] }));

      service.init();
      service.init();

      expect(api.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('refresh', () => {
    it('stores returned items and clears loading/error on success', () => {
      api.get.and.returnValue(of({ items: [makeItem(), makeItem({ key: 'k2' })] }));

      service.refresh();

      expect(service.items().map((it) => it.key)).toEqual(['k1', 'k2']);
      expect(service.loading()).toBe(false);
      expect(service.error()).toBeNull();
    });

    it('falls back to an empty list when the response items are not an array', () => {
      api.get.and.returnValue(of({ items: 'nope' } as never));

      service.refresh();

      expect(service.items()).toEqual([]);
      expect(service.loading()).toBe(false);
    });

    it('falls back to an empty list when the response is null', () => {
      api.get.and.returnValue(of(null as never));

      service.refresh();

      expect(service.items()).toEqual([]);
    });

    it('caps the stored list at the maximum number of items', () => {
      const many = Array.from({ length: 60 }, (_, i) => makeItem({ key: `k${i}` }));
      api.get.and.returnValue(of({ items: many }));

      service.refresh();

      expect(service.items().length).toBe(50);
    });

    it('sets an error message and clears loading on failure (echoes key when untranslated)', () => {
      api.get.and.returnValue(throwError(() => new Error('boom')));

      service.refresh();

      expect(service.error()).toBe('adminUi.favorites.errors.load');
      expect(service.loading()).toBe(false);
    });

    it('uses the translated value when a translation exists', () => {
      translate.instant.and.returnValue('Could not load favorites');
      api.get.and.returnValue(throwError(() => new Error('boom')));

      service.refresh();

      expect(service.error()).toBe('Could not load favorites');
    });
  });

  describe('isFavorite', () => {
    beforeEach(() => {
      service.add(makeItem({ key: 'fav' }));
    });

    it('returns true for a stored key', () => {
      expect(service.isFavorite('fav')).toBe(true);
    });

    it('trims the queried key before comparing', () => {
      expect(service.isFavorite('  fav  ')).toBe(true);
    });

    it('returns false for an unknown key', () => {
      expect(service.isFavorite('missing')).toBe(false);
    });

    it('returns false for a blank key', () => {
      expect(service.isFavorite('   ')).toBe(false);
    });

    it('returns false for a null key', () => {
      expect(service.isFavorite(null as never)).toBe(false);
    });
  });

  describe('toggle', () => {
    it('adds the item when it is not yet a favorite', () => {
      const addSpy = spyOn(service, 'add').and.callThrough();

      service.toggle(makeItem({ key: 'new' }));

      expect(addSpy).toHaveBeenCalled();
      expect(service.isFavorite('new')).toBe(true);
    });

    it('removes the item when it is already a favorite', () => {
      service.add(makeItem({ key: 'fav' }));
      const removeSpy = spyOn(service, 'remove').and.callThrough();

      service.toggle(makeItem({ key: 'fav' }));

      expect(removeSpy).toHaveBeenCalledWith('fav');
      expect(service.isFavorite('fav')).toBe(false);
    });
  });

  describe('add', () => {
    it('does nothing when the item is null', () => {
      service.add(null as never);
      expect(api.put).not.toHaveBeenCalled();
      expect(service.items()).toEqual([]);
    });

    it('does nothing when the key is blank', () => {
      service.add(makeItem({ key: '   ' }));
      expect(api.put).not.toHaveBeenCalled();
    });

    it('prepends a normalized item and persists it', () => {
      service.add(makeItem({ key: '  a  ', label: '  Trimmed  ', subtitle: '  sub  ' }));

      const sent = lastSent();
      expect(sent.items[0].key).toBe('a');
      expect(sent.items[0].label).toBe('Trimmed');
      expect(sent.items[0].subtitle).toBe('sub');
      expect(service.isFavorite('a')).toBe(true);
    });

    it('falls back to the url when the label is blank', () => {
      service.add(makeItem({ key: 'a', label: '   ', url: '/from-url' }));

      expect(lastSent().items[0].label).toBe('/from-url');
    });

    it('falls back to "/" for the url when it is blank', () => {
      service.add(makeItem({ key: 'a', label: 'Has label', url: '   ' }));

      expect(lastSent().items[0].url).toBe('/');
    });

    it('normalizes empty string label, subtitle and url fields', () => {
      service.add(makeItem({ key: 'a', label: '', subtitle: '', url: '' }));

      const sent = lastSent();
      // Empty label falls back to the (empty) url, empty subtitle stays empty,
      // and an empty url is replaced by the root path.
      expect(sent.items[0].label).toBe('');
      expect(sent.items[0].subtitle).toBe('');
      expect(sent.items[0].url).toBe('/');
    });

    it('keeps a valid object state', () => {
      service.add(makeItem({ key: 'a', state: { foo: 'bar' } }));

      expect(lastSent().items[0].state).toEqual({ foo: 'bar' });
    });

    it('nulls a non-object state', () => {
      service.add(makeItem({ key: 'a', state: 'not-an-object' as never }));

      expect(lastSent().items[0].state).toBeNull();
    });

    it('nulls a null state', () => {
      service.add(makeItem({ key: 'a', state: null }));

      expect(lastSent().items[0].state).toBeNull();
    });

    it('deduplicates an existing key by moving it to the front', () => {
      service.add(makeItem({ key: 'a' }));
      service.add(makeItem({ key: 'b' }));

      service.add(makeItem({ key: 'a', label: 'Again' }));

      const sent = lastSent();
      expect(sent.items.map((it) => it.key)).toEqual(['a', 'b']);
      expect(sent.items[0].label).toBe('Again');
    });

    it('caps the persisted list at the maximum number of items', () => {
      for (let i = 0; i < 55; i++) {
        service.add(makeItem({ key: `k${i}` }));
      }

      expect(lastSent().items.length).toBe(50);
    });
  });

  describe('remove', () => {
    it('does nothing for a blank key', () => {
      service.remove('   ');
      expect(api.put).not.toHaveBeenCalled();
    });

    it('does nothing for a null key', () => {
      service.remove(null as never);
      expect(api.put).not.toHaveBeenCalled();
    });

    it('removes a stored key and persists the result', () => {
      service.add(makeItem({ key: 'a' }));
      service.add(makeItem({ key: 'b' }));

      service.remove('a');

      expect(lastSent().items.map((it) => it.key)).toEqual(['b']);
      expect(service.isFavorite('a')).toBe(false);
    });
  });

  describe('clear', () => {
    it('does nothing when the list is already empty', () => {
      service.clear();
      expect(api.put).not.toHaveBeenCalled();
    });

    it('persists an empty list when there are favorites', () => {
      service.add(makeItem({ key: 'a' }));

      service.clear();

      expect(lastSent().items).toEqual([]);
      expect(service.items()).toEqual([]);
    });
  });

  describe('save (via add)', () => {
    it('replaces the optimistic list with the server response on success', () => {
      const serverItem = makeItem({ key: 'a', label: 'Server label' });
      api.put.and.returnValue(of({ items: [serverItem] }));

      service.add(makeItem({ key: 'a', label: 'Optimistic' }));

      expect(service.items()).toEqual([serverItem]);
      expect(service.loading()).toBe(false);
      expect(service.error()).toBeNull();
    });

    it('keeps the optimistic list when the response items are not an array', () => {
      api.put.and.returnValue(of({ items: 'bad' } as never));

      service.add(makeItem({ key: 'a' }));

      expect(service.items().map((it) => it.key)).toEqual(['a']);
      expect(service.loading()).toBe(false);
    });

    it('reverts and shows a toast on failure', () => {
      api.put.and.returnValue(throwError(() => new Error('boom')));

      service.add(makeItem({ key: 'a' }));

      expect(service.items()).toEqual([]);
      expect(service.loading()).toBe(false);
      expect(toast.error).toHaveBeenCalledOnceWith('adminUi.favorites.errors.save');
    });
  });
});
