import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-locals': 'off',
      '@typescript-eslint/no-unused-parameters': 'off',
      "@typescript-eslint/ban-ts-comment": ["error", {
          "ts-ignore": false, // Allow using @ts-ignore
          "ts-expect-error": true,
      }],
      'no-unused-vars': 'off',
      'no-unused-locals': 'off',
      'no-unused-parameters': 'off',
    },
  },
)
