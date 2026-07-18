import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/*.js', '**/*.cjs', '**/*.mjs', 'node_modules', 'dist', 'coverage'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  // WU6/WU13 (B6): server-side SSR theme-sink lint-ban. The express request-time
  // path (`src/server.ts`) and its portable modules (`src/server/**`) are the one
  // place a stylesheet STRING is emitted into the SSR `<head>`. Ban the two sink
  // primitives here so no NEW `innerHTML`/`outerHTML` write or Angular sanitizer
  // bypass (`bypassSecurityTrust*`) can be introduced alongside the one permitted,
  // hash-pinned `<style id="ms-theme">` assembly in `theme-head.ts` (which uses
  // only WU2-validated string concatenation — no DOM API, no bypass). These globs
  // are relative to this config's dir and are covered by `tsconfig.eslint.json`
  // (`include: ["src/**/*.ts"]`), so server TS is genuinely in the lint project.
  {
    files: ['src/server.ts', 'src/server/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^bypassSecurityTrust/]',
          message:
            'Server-side theme sink (src/server/**): Angular sanitizer bypass (bypassSecurityTrust*) is banned. The only permitted head sink is theme-head.ts’s hash-pinned <style> string assembly over WU2-validated tokens (WU6/B6).',
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(inner|outer)HTML$/]",
          message:
            'Server-side theme sink (src/server/**): innerHTML/outerHTML assignment is banned. Emit only the controlled <style id="ms-theme"> string via theme-head.ts (WU6/B6).',
        },
      ],
    },
  },
);
