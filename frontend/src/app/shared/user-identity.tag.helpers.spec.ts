import { formatIdentity } from './user-identity';

/** Golden WU tip orphan — formatIdentity name-only / tag type gate. */
describe('formatIdentity name-only / tag gate (golden WU)', () => {
  it('returns name alone when username is empty', () => {
    expect(formatIdentity({ name: 'Ada', username: '' })).toBe('Ada');
    expect(formatIdentity({ name: 'Ada', username: '   ' })).toBe('Ada');
  });

  it('ignores non-number tags when both name and username exist', () => {
    expect(formatIdentity({ name: 'Ada', username: 'ada', name_tag: '7' as any })).toBe(
      'Ada (ada)',
    );
  });
});
