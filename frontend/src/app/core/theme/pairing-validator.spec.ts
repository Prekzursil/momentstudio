import { meetsAa } from './contrast';
import { getToken } from './token-taxonomy';
import {
  type ChangeValidation,
  pairingsForToken,
  type SnapCandidate,
  validateTokenChange,
} from './pairing-validator';

/** Every pairing in a validation result passes its own AA target. */
function allCandidatePairsPass(candidate: SnapCandidate): boolean {
  return candidate.pairs.every((pair) => pair.after.ratio >= pair.target);
}

describe('pairingsForToken', () => {
  it('returns the pairings where the token is the foreground', () => {
    const pairings = pairingsForToken('--accent');
    expect(pairings.length).toBeGreaterThan(0);
    for (const pair of pairings) {
      expect(pair.foreground === '--accent' || pair.background === '--accent').toBe(true);
    }
    // `--accent` is only ever a foreground in the matrix.
    expect(pairings.every((pair) => pair.foreground === '--accent')).toBe(true);
  });

  it('returns the pairings where the token is the background', () => {
    const pairings = pairingsForToken('--background');
    expect(pairings.length).toBeGreaterThan(0);
    expect(pairings.every((pair) => pair.background === '--background')).toBe(true);
  });

  it('returns nothing for a token in no pairing', () => {
    expect(pairingsForToken('--surface-inverse')).toEqual([]);
    expect(pairingsForToken('--font-body')).toEqual([]);
    expect(pairingsForToken('--not-a-token')).toEqual([]);
  });
});

describe('validateTokenChange — passing paths', () => {
  it('returns ok for a colour change that keeps every pairing above AA', () => {
    // `--text-heading` default is very dark; nudging it a shade darker only
    // widens contrast, so every heading pairing still passes.
    const result = validateTokenChange('--text-heading', '10 12 20');
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.token).toBe('--text-heading');
    expect(result.value).toBe('10 12 20');
  });

  it('returns ok without parsing the value for a non-colour (font) token', () => {
    const result = validateTokenChange('--font-body', 'Inter, system-ui, sans-serif');
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.candidates).toEqual([]);
    // A font string is not an "R G B" triplet — proof it was never parsed.
    expect(result.value).toBe('Inter, system-ui, sans-serif');
  });

  it('returns ok for a colour token that participates in no pairing', () => {
    const result = validateTokenChange('--overlay', '0 0 0');
    expect(result.ok).toBe(true);
    expect(result.candidates).toEqual([]);
  });

  it('never fires for the shipped normal-tier palette (every seed colour, default)', () => {
    const colorTokens = [
      '--background',
      '--surface',
      '--text',
      '--text-heading',
      '--text-muted',
      '--accent',
    ];
    for (const name of colorTokens) {
      const token = getToken(name);
      expect(token).withContext(`${name} is a taxonomy token`).toBeTruthy();
      const result = validateTokenChange(name, token!.compiledDefault);
      expect(result.ok).withContext(`${name} at its default must not fire`).toBe(true);
      expect(result.failures).withContext(`${name} default has no failure`).toEqual([]);
    }
  });
});

describe('validateTokenChange — failing paths + auto-snap', () => {
  /** A near-white body text on the white canvas: a clear AA failure. */
  const failing: ChangeValidation = validateTokenChange('--text', '230 230 230');

  it('reports the failing pairing with its measured ratio vs pinned target', () => {
    expect(failing.ok).toBe(false);
    expect(failing.failures.length).toBeGreaterThan(0);
    for (const failure of failing.failures) {
      expect(failure.passes).toBe(false);
      expect(failure.swatch.ratio).toBeLessThan(failure.target);
      expect(failure.target).toBe(failure.pairing.minRatio);
      // The failing pairing must be one `--text` participates in.
      const involvesText =
        failure.pairing.foreground === '--text' || failure.pairing.background === '--text';
      expect(involvesText).toBe(true);
    }
  });

  it('returns at least one passing auto-snap candidate', () => {
    expect(failing.candidates.length).toBeGreaterThanOrEqual(1);
    expect(failing.candidates.length).toBeLessThanOrEqual(3);
    for (const candidate of failing.candidates) {
      expect(candidate.token).toBe('--text');
      expect(allCandidatePairsPass(candidate)).withContext(candidate.value).toBe(true);
      expect(candidate.minRatio).toBeGreaterThanOrEqual(failing.failures[0].target);
    }
  });

  it('carries before/after swatch data for each candidate (side-by-side display)', () => {
    const [candidate] = failing.candidates;
    expect(candidate.pairs.length).toBe(pairingsForToken('--text').length);
    for (const pair of candidate.pairs) {
      expect(pair.before).toBeTruthy();
      expect(pair.after).toBeTruthy();
      // The candidate is a strictly better (or equal) ratio than the failing pair.
      expect(pair.after.ratio).toBeGreaterThanOrEqual(pair.before.ratio);
      expect(pair.after.ratio).toBeGreaterThanOrEqual(pair.target);
    }
  });

  it("auto-snap candidate actually passes AA when re-validated", () => {
    const [candidate] = failing.candidates;
    const revalidated = validateTokenChange('--text', candidate.value);
    expect(revalidated.ok).toBe(true);
    expect(revalidated.failures).toEqual([]);
    // And each pairing genuinely clears its tagged threshold via the maths.
    for (const pair of candidate.pairs) {
      const size = pair.target === 4.5 ? 'body' : 'large';
      expect(meetsAa(pair.after.ratio, size)).toBe(true);
    }
  });

  it('offers no more than three candidates for a wide passing region', () => {
    // Slightly-too-light text: a large passing region toward black; capped at 3.
    const result = validateTokenChange('--text', '200 200 200');
    expect(result.ok).toBe(false);
    expect(result.candidates.length).toBe(3);
  });

  it('honours an in-progress draft overlay when resolving the other endpoint', () => {
    // Push `--background` (the other endpoint) to mid-grey via the overlay, so
    // only a very dark `--text` passes — proof the overlay is read, not the default.
    const result = validateTokenChange('--text', '140 140 140', { '--background': '128 128 128' });
    expect(result.ok).toBe(false);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    for (const candidate of result.candidates) {
      expect(allCandidatePairsPass(candidate)).toBe(true);
      // Its before-swatch background is the overlaid mid-grey, not white.
      const bgPair = candidate.pairs.find((pair) => pair.pairingId === 'text-on-background');
      expect(bgPair?.before.background as readonly number[]).toEqual([128, 128, 128]);
    }
  });

  it('returns no candidates when no single value can satisfy every pairing', () => {
    // Force `--accent` (a foreground on `--background`) to pure white via the
    // overlay: as the background changes, a light background fails white-accent
    // while a dark background fails the dark text/heading foregrounds — so no
    // single `--background` value clears every pairing at once.
    const result = validateTokenChange('--background', '128 128 128', {
      '--accent': '255 255 255',
    });
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.candidates).toEqual([]);
  });
});
