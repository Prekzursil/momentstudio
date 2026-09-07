import { LoginComponent } from './login.component';

/** Golden WU login-redirect-path — normalizeNextUrl. */
describe('LoginComponent normalizeNextUrl (golden WU tip)', () => {
  it('accepts relative paths and rejects unsafe next values', () => {
    const cmp = Object.create(LoginComponent.prototype) as LoginComponent;
    const norm = (raw: string | null) => (cmp as any).normalizeNextUrl(raw);
    expect(norm(null)).toBeNull();
    expect(norm('')).toBeNull();
    expect(norm('   ')).toBeNull();
    expect(norm('https://evil.test')).toBeNull();
    expect(norm('//evil.test')).toBeNull();
    expect(norm('/login')).toBeNull();
    expect(norm('/login?x=1')).toBeNull();
    expect(norm('/account')).toBe('/account');
    expect(norm(' /shop/rings ')).toBe('/shop/rings');
  });
});
