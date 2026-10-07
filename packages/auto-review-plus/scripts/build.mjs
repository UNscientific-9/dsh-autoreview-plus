import { spawnSync } from 'node:child_process'
import { build } from 'tsdown'
const checked = spawnSync(process.execPath, ['scripts/tool.mjs', 'tsc', '-p', 'tsconfig.json'], { stdio: 'inherit' })
if (checked.status !== 0) process.exit(checked.status ?? 1)
await build({ config: false, entry: { index: 'src/index.ts' }, outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024', clean: false, dts: false, fixedExtension: false, deps: { neverBundle: [/^node:/, /^@deepseek-ai\//], alwaysBundle: ['zod', 'undici'] } })
await build({ config: false, entry: { client: 'src/client/index.ts' }, outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2022', clean: false, dts: false, deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives'], alwaysBundle: ['zod'] }, define: { 'process.env.NODE_ENV': JSON.stringify('production') }, outputOptions: { entryFileNames: 'client.js', banner: 'window.__ModuleLoader__.load({ id: "dsh-experimental-auto-review-plus", factory: (require) => {', footer: 'return module.exports; } });', intro: 'var module = { exports: {} }; var exports = module.exports;' } })
console.log('官方 Plus 后端与侧边栏客户端已构建。')
