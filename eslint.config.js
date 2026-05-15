import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'public', 'src/**/generated/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      eslintConfigPrettier,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // shadcn-style ui kit: components co-export variants/helpers by design
    files: ['src/shared/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Generated API client is an implementation detail of @/shared/api.
    // Consumers must import from the facade, not reach into generated/.
    // Mocks under `src/app/mocks/**` are an explicit exception — they implement
    // the same OpenAPI contract on the server side and need the raw types.
    files: [
      'src/features/**/*.{ts,tsx}',
      'src/pages/**/*.{ts,tsx}',
      'src/app/**/*.{ts,tsx}',
      'src/entities/**/*.{ts,tsx}',
    ],
    ignores: ['src/app/mocks/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/shared/api/generated/**', '@/shared/api/generated/**'],
              message: 'Import from @/shared/api (the facade), not the generated OpenAPI client.',
            },
          ],
        },
      ],
    },
  },
])
