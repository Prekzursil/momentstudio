import { DERIVED_COLOR_NAMES } from './theme-derive';
import { SEED_TOKENS } from './token-taxonomy';
import { ThemeTokensService } from './theme-tokens.service';

const ROOT = document.documentElement;

/** Remove every seed + derived token property this suite may have written. */
function clearSeedTokens(): void {
  for (const token of SEED_TOKENS) {
    ROOT.style.removeProperty(token.name);
  }
  for (const name of DERIVED_COLOR_NAMES) {
    ROOT.style.removeProperty(name);
  }
  ROOT.style.removeProperty('--totally-unknown');
}

describe('ThemeTokensService', () => {
  beforeEach(() => clearSeedTokens());
  afterEach(() => clearSeedTokens());

  it('applyToken with a valid triplet routes through WU2 and sets the property', () => {
    const service = new ThemeTokensService();
    const result = service.applyToken('--accent', '10 20 30');
    expect(result.ok).toBeTrue();
    expect(result.value).toBe('10 20 30');
    expect(ROOT.style.getPropertyValue('--accent')).toBe('10 20 30');
    expect(service.getToken('--accent')).toBe('10 20 30');
  });

  it('never emits a CSS-breakout payload — falls back to the compiled default', () => {
    const service = new ThemeTokensService();
    const spy = spyOn(ROOT.style, 'setProperty').and.callThrough();
    const payload = '9 9 9) } html{background:red';
    const result = service.applyToken('--background', payload);
    expect(result.ok).toBeFalse();
    // The tainted payload NEVER reaches setProperty...
    expect(spy).not.toHaveBeenCalledWith('--background', payload);
    // ...only the compiled default (WU2 registry fallback) is applied.
    expect(spy).toHaveBeenCalledWith('--background', '255 255 255');
    expect(ROOT.style.getPropertyValue('--background')).toBe('255 255 255');
    expect(service.getToken('--background')).toBe('255 255 255');
  });

  it('rejects a hex value in a triplet slot to the compiled default', () => {
    const service = new ThemeTokensService();
    const result = service.applyToken('--background', '#fff');
    expect(result.ok).toBeFalse();
    expect(result.value).toBe('255 255 255');
    expect(ROOT.style.getPropertyValue('--background')).toBe('255 255 255');
  });

  it('never touches the DOM for an unknown (non-registry) token name', () => {
    const service = new ThemeTokensService();
    const spy = spyOn(ROOT.style, 'setProperty').and.callThrough();
    const result = service.applyToken('--totally-unknown', '1 2 3');
    expect(result.ok).toBeFalse();
    expect(result.value).toBe('');
    expect(spy).not.toHaveBeenCalled();
    expect(service.getToken('--totally-unknown')).toBeUndefined();
  });

  it('hydrates from the server-injected :root tokens without a re-fetch', () => {
    // Simulate the WU6 `<style id="ms-theme">` overriding two tokens on the
    // element (an inline custom property wins over the stylesheet `:root`).
    ROOT.style.setProperty('--background', '1 2 3');
    ROOT.style.setProperty('--accent', '4 5 6');
    const fetchSpy = spyOn(window, 'fetch');

    const service = new ThemeTokensService();

    // Overridden tokens hydrate to the injected values...
    expect(service.getToken('--background')).toBe('1 2 3');
    expect(service.getToken('--accent')).toBe('4 5 6');
    // ...and a non-overridden token hydrates to the effective `:root` default
    // (proving hydration reads the cascaded `:root`, not a re-fetch).
    expect(service.getToken('--overlay')).toBe('0 0 0');
    // Hydration reads the DOM — it must not call the network.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exposes a read-only snapshot of the resolved token map', () => {
    ROOT.style.setProperty('--text', '7 8 9');
    const service = new ThemeTokensService();
    const map = service.tokens()();
    expect(map.get('--text')).toBe('7 8 9');
  });

  it('recomputes derived on-colours when a primary changes (live preview)', () => {
    const service = new ThemeTokensService();
    // Drive --surface-inverse near-white: the derived --text-inverse must flip to
    // black to keep contrast — the admin never sets --text-inverse directly.
    service.applyToken('--surface-inverse', '250 250 250');
    expect(service.getToken('--text-inverse')).toBe('0 0 0');
    expect(ROOT.style.getPropertyValue('--text-inverse')).toBe('0 0 0');
    // And a dark inverse surface -> white on-colour.
    service.applyToken('--surface-inverse', '15 23 42');
    expect(service.getToken('--text-inverse')).toBe('255 255 255');
  });

  it('rejects a DERIVED token name — it is not an editable key', () => {
    const service = new ThemeTokensService();
    const spy = spyOn(ROOT.style, 'setProperty').and.callThrough();
    const result = service.applyToken('--surface-inverse-hover', '255 255 255');
    expect(result.ok).toBeFalse();
    expect(result.value).toBe('');
    expect(spy).not.toHaveBeenCalledWith('--surface-inverse-hover', '255 255 255');
  });

  it('applies a non-colour editable token without triggering derivation', () => {
    const service = new ThemeTokensService();
    const result = service.applyToken('--font-body', 'system-ui, sans-serif');
    expect(result.ok).toBeTrue();
    expect(ROOT.style.getPropertyValue('--font-body')).toBe('system-ui, sans-serif');
  });
});
