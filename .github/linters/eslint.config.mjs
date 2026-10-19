import jsonc from 'eslint-plugin-jsonc';

// JSON validation uses ESLint; ESM sources use Super-Linter's Biome integration.
export default jsonc.configs['recommended-with-json'].map(config => ({
  ...config,
  files: ['**/*.json'],
}));
