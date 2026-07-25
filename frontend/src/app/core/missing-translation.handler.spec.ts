import { MissingTranslationHandlerParams } from '@ngx-translate/core';

import { AppMissingTranslationHandler } from './missing-translation.handler';

function makeParams(key: unknown): MissingTranslationHandlerParams {
  return { key } as unknown as MissingTranslationHandlerParams;
}

describe('AppMissingTranslationHandler', () => {
  let handler: AppMissingTranslationHandler;

  beforeEach(() => {
    handler = new AppMissingTranslationHandler();
  });

  it('returns an empty string when params is null (optional-chaining null branch)', () => {
    expect(handler.handle(null as unknown as MissingTranslationHandlerParams)).toBe('');
  });

  it('returns an empty string when the key is undefined (nullish-coalescing branch)', () => {
    expect(handler.handle(makeParams(undefined))).toBe('');
  });

  it('returns an empty string when the key is only whitespace', () => {
    expect(handler.handle(makeParams('   '))).toBe('');
  });

  it('returns the explicit critical fallback label when one exists for the key', () => {
    expect(handler.handle(makeParams('nav.home'))).toBe('Home');
    expect(handler.handle(makeParams('app.name'))).toBe('momentstudio');
    expect(handler.handle(makeParams('auth.loginTitle'))).toBe('Sign in');
  });

  it('humanizes a camelCase leaf segment into a capitalized, spaced label', () => {
    expect(handler.handle(makeParams('settings.profile.fooBar'))).toBe('Foo Bar');
  });

  it('humanizes snake_case and dash-separated leaf segments', () => {
    expect(handler.handle(makeParams('page_title-suffix'))).toBe('Page title suffix');
  });

  it('collapses repeated separators and whitespace inside the leaf', () => {
    expect(handler.handle(makeParams('section.multi__word--leaf'))).toBe('Multi word leaf');
  });

  it('falls back to the full key when the leaf segment is empty (key ends with a dot)', () => {
    expect(handler.handle(makeParams('trailing.'))).toBe('Trailing.');
  });

  it('returns the original key when the normalized leaf becomes empty', () => {
    expect(handler.handle(makeParams('___'))).toBe('___');
  });

  it('capitalizes a single lowercase leaf word', () => {
    expect(handler.handle(makeParams('contact'))).toBe('Contact');
  });

  it('coerces a non-string key via template interpolation before trimming', () => {
    expect(handler.handle(makeParams(12345))).toBe('12345');
  });
});
