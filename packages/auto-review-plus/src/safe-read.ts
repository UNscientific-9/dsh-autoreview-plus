import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

interface Snapshot {
  cwd: string; projectInstructions: readonly unknown[]
  history: readonly { role: string; content?: readonly { type: string; text?: string }[] }[]
  action: { name: string; arguments: unknown }
}
/** Conservative fast path: only an identified official local read tool. */
export async function safeRead(snapshot: Snapshot, trusted: boolean): Promise<boolean> {
  if (!trusted || snapshot.action.name !== 'read' || snapshot.projectInstructions.length > 0) return false
  // Arbitrary instructions cannot be proved compatible by a keyword blacklist.
  // Let the reviewer interpret user/parent instructions, constraints and checkpoints.
  if (snapshot.history.some(item => item.role !== 'fact' && (item.content?.length ?? 0) > 0)) return false
  const args = snapshot.action.arguments
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return false
  const values = args as Record<string, unknown>
  // The official read tool takes `file_path`; only these three keys may appear.
  if (typeof values.file_path !== 'string' || Object.keys(values).some(key => !['file_path', 'offset', 'limit'].includes(key))) return false
  if ([values.offset, values.limit].some(value => value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1))) return false
  try {
    const cwd = await realpath(snapshot.cwd)
    const target = await realpath(path.resolve(cwd, values.file_path))
    const relative = path.relative(cwd, target)
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return false
    if (relative.split(/[\\/]/u).some(part => /^\.|credential|secret|password|token|private[-_]?key/iu.test(part))) return false
    if (!/\.(?:txt|md|ts|tsx|js|jsx|py|json|ya?ml|toml|css|html)$/iu.test(target)) return false
    const info = await stat(target)
    if (!info.isFile() || info.size > 128 * 1024) return false
    const content = await readFile(target)
    if (content.includes(0) || /PRIVATE KEY|\b(?:sk-|gh[pousr]_|github_pat_)|(?:api[-_]?key|password|secret|token)\s*["']?\s*[:=]/iu.test(content.toString('utf8'))) return false
    return true
  } catch { return false }
}
