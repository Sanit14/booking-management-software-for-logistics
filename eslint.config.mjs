import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig(
  { ignores: ['dist', 'dist-electron', 'release', 'build', 'node_modules', '.claude', 'docs', 'scripts'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { files: ['src/**/*.{ts,tsx}'], extends: [reactHooks.configs.flat.recommended] },
);
