import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
// Preserve linked package paths so React and its renderer share one module identity on Windows.
export default defineConfig({ resolve: { preserveSymlinks: true, dedupe: ['react', 'react-dom'], alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./tests/host-menu.tsx', import.meta.url)) } }, test: { pool: 'forks', setupFiles: ['tests/setup.ts'], projects: [
  { test: { name: 'host', environment: 'node', include: ['tests/**/*.spec.ts'], exclude: ['tests/client*.spec.ts'], setupFiles: ['tests/setup.ts'] } },
  { extends: true, test: { name: 'client', environment: 'jsdom', include: ['tests/client*.spec.ts'] } },
] } })
