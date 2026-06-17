import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import prettier from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import jest from 'eslint-plugin-jest';
import testingLibrary from 'eslint-plugin-testing-library';
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
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    // Jest + Testing Library unit/component tests.
    files: ['src/**/*.spec.{ts,tsx}'],
    plugins: {
      ...jest.configs['flat/recommended'].plugins,
      ...jest.configs['flat/style'].plugins,
      ...testingLibrary.configs['flat/react'].plugins,
    },
    languageOptions: {
      ...jest.configs['flat/recommended'].languageOptions,
      ...jest.configs['flat/style'].languageOptions,
      globals: {
        ...jest.configs['flat/recommended'].languageOptions?.globals,
        ...globals.node,
      },
    },
    rules: {
      ...jest.configs['flat/recommended'].rules,
      ...jest.configs['flat/style'].rules,
      ...testingLibrary.configs['flat/react'].rules,
    },
  },
  prettier,
);
