/** @type {import('tailwindcss').Config} */

// Storefront-scoped theme-token aliases (P1a WU5). These keys are consumed ONLY by the
// 7 storefront core files (+ banner-block); the shared `slate`/`indigo` primitives are
// deliberately NOT remapped, so the admin UI (`pages/admin/**`) keeps its baked palette
// and is never repainted by a storefront theme (WU0 memo §2).
//
// Each alias is `rgb(var(--token, <light-fallback>) / <alpha-value>)` over the frozen
// bare `R G B` triplet wire format (WU0 memo §4). The `var()` fallback is the LIGHT
// compiled default so a surface renders correctly even before the WU6 SSR block injects
// `:root` tokens. Dark re-themes at runtime because styles.css `:root.dark` reassigns
// these same custom properties to their dark values (NO baked `dark:` variants remain
// on core surfaces) — so a single `bg-surface` flips light<->dark through the token.
//
// The set is a role + STATE vocabulary (base vs raised vs muted vs hover vs inverse,
// text vs strong vs secondary vs muted vs heading, border vs muted vs strong) so no two
// core-surface shades that render differently collapse onto one token (WU0 memo §1A/§2);
// a full numeric 50->950 ramp stays deferred to P2.
const alias = (token, fallback) => `rgb(var(${token}, ${fallback}) / <alpha-value>)`;

module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body, Inter, system-ui, -apple-system, sans-serif)'],
        heading: ['var(--font-heading, Cinzel, ui-serif, Georgia, serif)'],
      },
      colors: {
        // Backgrounds / page canvas.
        background: alias('--background', '255 255 255'),
        'background-subtle': alias('--background-subtle', '248 250 252'),
        // Surfaces (raised panels, wells, hover fills, inverse chips).
        surface: alias('--surface', '241 245 249'),
        'surface-muted': alias('--surface-muted', '248 250 252'),
        'surface-raised': alias('--surface-raised', '226 232 240'),
        'surface-inverse': alias('--surface-inverse', '15 23 42'),
        'surface-inverse-hover': alias('--surface-inverse-hover', '30 41 59'),
        field: alias('--field', '255 255 255'),
        overlay: alias('--overlay', '0 0 0'),
        // Text roles.
        text: alias('--text', '51 65 85'),
        'text-secondary': alias('--text-secondary', '71 85 105'),
        'text-muted': alias('--text-muted', '100 116 139'),
        'text-strong': alias('--text-strong', '30 41 59'),
        'text-heading': alias('--text-heading', '15 23 42'),
        // `inverse` / `onmedia` are consumed only via `text-*`; the vars are
        // `--text-inverse` / `--text-onmedia`.
        inverse: alias('--text-inverse', '255 255 255'),
        onmedia: alias('--text-onmedia', '255 255 255'),
        // Borders / dividers / rings.
        border: alias('--border', '226 232 240'),
        'border-muted': alias('--border-muted', '226 232 240'),
        'border-strong': alias('--border-strong', '203 213 225'),
        'border-inverse': alias('--border-inverse', '15 23 42'),
        // Accent (links, focus rings, native form-control accent).
        accent: alias('--accent', '79 70 229'),
        'accent-strong': alias('--accent-strong', '55 48 163'),
        'accent-subtle': alias('--accent-subtle', '238 242 255'),
      },
    },
  },
  plugins: [],
};
