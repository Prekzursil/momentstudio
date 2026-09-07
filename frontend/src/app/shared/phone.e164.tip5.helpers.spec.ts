import { buildE164, splitE164 } from './phone';

/** Golden WU tip orphan — phone E.164 helpers. */
describe('phone E164 helpers (golden WU tip5)', () => {
  it('builds and splits valid RO numbers', () => {
    const e164 = buildE164('RO', '0721123456');
    expect(e164).toMatch(/^\+40/);
    if (e164) {
      expect(splitE164(e164).country).toBe('RO');
      expect(splitE164(e164).nationalNumber.length).toBeGreaterThan(0);
    }
    expect(buildE164('RO', '')).toBeNull();
  });
});
