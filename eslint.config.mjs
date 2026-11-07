import nextVitals from 'eslint-config-next/core-web-vitals'
import noHardcodedColors, { noHardcodedColorsCssProcessor } from './eslint/rules/no-hardcoded-colors.mjs'



const atelierPlugin = {
  rules: {
    'no-hardcoded-colors': noHardcodedColors,
  },
  processors: {
    css: noHardcodedColorsCssProcessor,
  },
}


const eslintConfig = [
  ...nextVitals,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
      '@next/next/no-img-element': 'off',
      'import/no-anonymous-default-export': 'off',
      'jsx-a11y/alt-text': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      atelier: atelierPlugin,
    },
    rules: {
      'atelier/no-hardcoded-colors': 'error',
    },
  },

  {
    files: ['src/**/*.module.css'],
    plugins: {
      atelier: atelierPlugin,
    },
    processor: 'atelier/css',
  },

  {
    ignores: [
      '.next/**',
      '.open-next/**',
      '.vercel/**',
      'cloudflare-env.d.ts',
      'node_modules/**',
      'supabase/.temp/**',
      'src/app/(app)/_backup.tsx.bak',
      'venv_scraper/**',
      'workers/**',
    ],
  },
]

export default eslintConfig
