import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 8 * 1024 * 1024 })
const files = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).toString('utf8').split('\0').filter(Boolean)
if (files.length === 0) { console.error('尚无暂存文件，无法完成公开提交检查。'); process.exit(1) }
const roots = new Set(['.gitignore', '.gitattributes', 'AGENTS.md', 'README.md', 'DESIGN.md', 'UPSTREAM.md', 'UPSTREAM.json', 'LICENSE'])
const allowed = file => roots.has(file) || ['upstream/auto-review/', 'packages/auto-review-plus/', 'scripts/'].some(prefix => file.startsWith(prefix))
const privatePath = /(?:^|\/)(?:node_modules|\.tmp|\.cache|\.pnpm-store|lib|dist|out|coverage|\.local-state)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|\.?credentials(?:\..*)?|secrets(?:\..*)?)$|\.(?:pem|key|pfx|p12|log|tgz|tar|zip|sqlite\w*|db)$/iu
const rules = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/u],
  ['API key', /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})\b/u],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['Literal credential', /(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*["']?\s*[:=]\s*["'][A-Za-z0-9_./+=-]{20,}["']/iu],
  ['Personal Windows path', /[A-Z]:[\\/]Users[\\/](?!Public\b|Default\b)[^\\/\s"']+/iu],
]
const failures = []
for (const file of files) {
  if (!allowed(file) || privatePath.test(file)) { failures.push(`${file}：不在公开提交范围`); continue }
  if (fs.lstatSync(new URL(`../${file}`, import.meta.url)).isSymbolicLink()) { failures.push(`${file}：禁止符号链接`); continue }
  const content = git(['show', `:${file}`])
  if (content.includes(0)) { failures.push(`${file}：需人工核对的二进制文件`); continue }
  for (const [name, pattern] of rules) if (pattern.test(content.toString('utf8'))) failures.push(`${file}：${name}`)
}
if (failures.length > 0) { console.error(failures.join('\n')); process.exit(1) }
console.log(`公开提交检查通过：${files.length} 个暂存文件；未发现所检查类型的敏感内容。`)
