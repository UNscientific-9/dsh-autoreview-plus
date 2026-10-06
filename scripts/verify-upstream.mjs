import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'UPSTREAM.json'), 'utf8'))
const baseline = path.join(root, 'upstream/auto-review')
const listed = new Set(manifest.files.map(file => file.path))
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name)
  if (entry.isSymbolicLink()) throw new Error('Baseline contains a symbolic link')
  return entry.isDirectory() ? walk(target) : [path.relative(root, target).replaceAll('\\', '/')]
})
const actual = walk(baseline)
if (actual.length !== listed.size || actual.some(file => !listed.has(file))) throw new Error('Official baseline file list changed')
for (const file of manifest.files) {
  if (!file.path.startsWith('upstream/auto-review/') || file.path.includes('..')) throw new Error('Invalid baseline path')
  const hash = createHash('sha256').update(fs.readFileSync(path.join(root, file.path))).digest('hex')
  if (hash !== file.sha256) throw new Error(`Official baseline changed: ${file.path}`)
}
const pkg = JSON.parse(fs.readFileSync(path.join(baseline, 'package.json'), 'utf8'))
if (pkg.name !== manifest.package || pkg.version !== manifest.version) throw new Error('Official package identity changed')
console.log(`官方基线校验通过：${manifest.package}@${manifest.version}，${actual.length} 个文件。`)
