const eslint = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const reacthooks = require('eslint-plugin-react-hooks');
const prettier = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

const files = ['**/*.{ts,tsx,js,jsx}'];
const ignores = ['node_modules/', '.expo/', 'ios/', 'android/', 'dist/', 'coverage/', 'bridge/'];

module.exports = [
  {
    files,
    ignores,
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        ...globals['shared-node-browser'],
        React: 'readonly',
        console: 'readonly',
        __DEV__: 'readonly',
        RequestInit: 'readonly',
        RequestInfo: 'readonly',
        BodyInit: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reacthooks,
      prettier,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      ...prettierConfig.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-console': 'off',
      'no-useless-escape': 'warn',
      'no-empty': 'warn',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'prettier/prettier': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      'require-yield': 'off',
    },
  },
];
