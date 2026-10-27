import { defineConfig } from 'oxlint'
import { julrPreset } from '@julr/tooling-configs/oxc/lint'

export default defineConfig({
  extends: [julrPreset({ adonisjs: true })],
  jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],

  ignorePatterns: [
    // TODO: remove once https://github.com/oxc-project/oxc/issues/10223 is fixed
    '**/.adonisjs/**',
    'node_modules/**',
    'build/**',
    '*.yml',
    '.agents/**',
    '.claude/**',
    'repos/**',
    'tools/oxlint/anti-slop/**',
  ],

  rules: {
    'oxc/no-accumulating-spread': 'error',
    'anti-slop/no-array-filter-map': 'error',
    'anti-slop/no-reduce-accumulator-copy': 'error',
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-conditional-empty-object-spread': 'error',
    'anti-slop/no-known-value-widening': 'error',
    'anti-slop/no-module-mocking': 'error',
    'anti-slop/no-object-parameters': 'error',
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-runtime-typeof': 'error',
    'anti-slop/no-shape-in-symbol-names': 'error',
    'anti-slop/no-unknown-parameters': 'error',
    'anti-slop/no-unknown-returns': 'error',
    'anti-slop/no-unknown-type-aliases': 'error',
    'anti-slop/no-unsafe-dictionary-type': 'error',
    'anti-slop/no-widen-then-assert': 'error',
    'anti-slop/require-readable-spacing': 'error',
    'anti-slop/require-safety-comment-for-type-assertion': 'error',
  },

  overrides: [
    {
      // A file past this size holds more than one responsibility. Blank lines and comments do not count.
      files: ['packages/*/src/**', 'packages/*/commands/**', 'packages/*/tests/**'],
      rules: { 'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }] },
    },
    {
      // The playground is the scaffolded AdonisJS API kit kept close to upstream, so it stays a realistic fixture.
      // The fixture apps overlay files on a copy of it.
      files: ['playground/**', 'packages/openapi/tests/fixtures/*_app/**'],
      rules: Object.fromEntries(
        [
          'anti-slop/require-readable-spacing',
          'anti-slop/no-unknown-parameters',
          'anti-slop/require-safety-comment-for-type-assertion',
          'typescript/no-floating-promises',
          'typescript/prefer-as-const',
        ].map(rule => [rule, 'off']),
      ),
    },
  ],
})
