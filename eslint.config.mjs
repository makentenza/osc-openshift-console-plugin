import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import prettier from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import cypress from 'eslint-plugin-cypress';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      react,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      // The base rule false-positives on TS type-signature param names; the TS
      // compiler (noUnusedLocals/Parameters) covers real unused-variable cases.
      'no-unused-vars': 'off',
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      }
    },
    settings: {
      react: {
        version: 'detect',
      },
    }
  },
  {
    files: ['integration-tests/**/*.{ts,tsx,js}'],
    ...cypress.configs.recommended,
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'writable',
      },
    },
    rules: {
      ...cypress.configs.recommended.rules,
      'no-console': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    // Cypress component tests (specs, support, SDK mock).
    files: ['cypress/**/*.{ts,tsx}'],
    ...cypress.configs.recommended,
    languageOptions: {
      ...cypress.configs.recommended.languageOptions,
      globals: {
        ...cypress.configs.recommended.languageOptions?.globals,
        ...globals.browser,
        require: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...cypress.configs.recommended.rules,
      'no-console': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    // CommonJS webpack config consumed by cypress.config.ts.
    files: ['cypress/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  prettier,
);
