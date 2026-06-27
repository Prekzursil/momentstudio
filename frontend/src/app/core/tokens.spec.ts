import { themeTokens } from './tokens';

describe('themeTokens', () => {
  it('exposes a colors and spacing group', () => {
    expect(Object.keys(themeTokens)).toEqual(['colors', 'spacing']);
  });

  describe('colors', () => {
    it('sets the page background to slate-50', () => {
      expect(themeTokens.colors.background).toBe('bg-slate-50');
    });

    it('sets the surface to white', () => {
      expect(themeTokens.colors.surface).toBe('bg-white');
    });

    it('sets the primary text to slate-900', () => {
      expect(themeTokens.colors.text).toBe('text-slate-900');
    });

    it('sets the muted text to slate-600', () => {
      expect(themeTokens.colors.muted).toBe('text-slate-600');
    });

    it('sets the border to slate-200', () => {
      expect(themeTokens.colors.border).toBe('border-slate-200');
    });

    it('defines a solid primary button with a hover state', () => {
      expect(themeTokens.colors.primary).toBe('bg-slate-900 text-white hover:bg-slate-800');
      expect(themeTokens.colors.primary).toContain('hover:');
    });

    it('defines a ghost primary button with a border and hover state', () => {
      expect(themeTokens.colors.primaryGhost).toBe(
        'border border-slate-200 text-slate-900 hover:border-slate-300',
      );
      expect(themeTokens.colors.primaryGhost).toContain('border');
      expect(themeTokens.colors.primaryGhost).toContain('hover:');
    });

    it('exposes exactly the documented color keys', () => {
      expect(Object.keys(themeTokens.colors)).toEqual([
        'background',
        'surface',
        'text',
        'muted',
        'border',
        'primary',
        'primaryGhost',
      ]);
    });
  });

  describe('spacing', () => {
    it('centers the container and caps it at max-w-6xl with responsive padding', () => {
      expect(themeTokens.spacing.container).toBe('max-w-6xl mx-auto px-4 sm:px-6');
    });

    it('exposes exactly the documented spacing keys', () => {
      expect(Object.keys(themeTokens.spacing)).toEqual(['container']);
    });
  });
});
