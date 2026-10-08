import { Buffer } from 'node:buffer'
import path from 'node:path'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { redactText } from './evidence.ts'

interface Snapshot {
  cwd: string; projectInstructions: readonly unknown[]
  history: readonly { role: string; content?: readonly { type: string; text?: string }[] }[]
  action: { name: string; arguments: unknown }
}

/** The public filesystem operations used to verify the target before a rule allow. */
export type SafeReadFileSystem = Pick<FileSystem, 'resolve' | 'contains' | 'stat' | 'readBytes' | 'processPath'>

const MAX_SAFE_READ_BYTES = 128 * 1024

type PathApi = typeof path.posix | typeof path.win32

function isWindowsAbsolute(value: string): boolean {
  return path.win32.isAbsolute(value) && (/^[a-z]:[\\/]/iu.test(value) || /^\\\\/u.test(value))
}

/** Parse only actual execution paths; `displayPath` may be a relative path or URI. */
function pathApiFor(rootPath: string, targetPath: string): PathApi | undefined {
  if (isWindowsAbsolute(rootPath) && isWindowsAbsolute(targetPath)) return path.win32
  if (path.posix.isAbsolute(rootPath) && path.posix.isAbsolute(targetPath)
    && !isWindowsAbsolute(rootPath) && !isWindowsAbsolute(targetPath)) return path.posix
  return undefined
}

function relativeSegments(api: PathApi, rootPath: string, targetPath: string): string[] | undefined {
  const relative = api.relative(rootPath, targetPath)
  if (relative === '' || relative === '..' || relative.startsWith(`..${api.sep}`) || api.isAbsolute(relative)) return undefined
  return relative.split(/[\\/]/u).filter(Boolean)
}

/** Conservative fast path: only an identified official local read tool. */
export async function safeRead(
  snapshot: Snapshot,
  trusted: boolean,
  fs: SafeReadFileSystem | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  if (!trusted || fs === undefined || signal === undefined || signal.aborted
    || snapshot.cwd.length === 0 || snapshot.action.name !== 'read' || snapshot.projectInstructions.length > 0) return false
  if (typeof fs.resolve !== 'function' || typeof fs.contains !== 'function' || typeof fs.stat !== 'function'
    || typeof fs.readBytes !== 'function' || typeof fs.processPath !== 'function') return false
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
    // Match tool-fs's session-cwd resolution through the mounted provider. The target key
    // remains opaque; containment and processPath are the only path identity operations here.
    const root = await fs.resolve('.', { cwd: snapshot.cwd, signal })
    if (signal.aborted || root?.targetKey == null) return false
    const rootInfo = await fs.stat(root, signal)
    if (signal.aborted || rootInfo?.type !== 'directory') return false

    const target = await fs.resolve(values.file_path, { cwd: snapshot.cwd, signal })
    if (signal.aborted || target?.targetKey == null || target.targetKey === root.targetKey) return false
    if (fs.contains(root, target) !== true) return false
    const info = await fs.stat(target, signal)
    if (signal.aborted || info?.type !== 'file') return false
    if (info.size !== undefined && (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > MAX_SAFE_READ_BYTES)) return false

    const rootPath = fs.processPath(root)
    const targetPath = fs.processPath(target)
    if (signal.aborted || typeof rootPath !== 'string' || typeof targetPath !== 'string') return false
    const api = pathApiFor(rootPath, targetPath)
    if (api === undefined) return false
    const segments = relativeSegments(api, rootPath, targetPath)
    if (segments === undefined || segments.some(part => /^\.|credential|secret|password|token|private[-_]?key/iu.test(part))) return false
    if (!/\.(?:txt|md|ts|tsx|js|jsx|py|json|ya?ml|toml|css|html)$/iu.test(api.extname(targetPath))) return false

    // The provider enforces this cap even when stat cannot report a size or the
    // file grows between stat and read. Reject a provider that violates the bound.
    const content = await fs.readBytes(target, signal, MAX_SAFE_READ_BYTES)
    if (signal.aborted || !(content instanceof Uint8Array) || content.byteLength > MAX_SAFE_READ_BYTES) return false
    const text = Buffer.from(content).toString('utf8')
    if (content.includes(0) || redactText(text) !== text
      || /PRIVATE KEY|\b(?:sk-|gh[pousr]_|github_pat_)|(?:api[-_]?key|password|secret|token)\s*["']?\s*[:=]/iu.test(text)) return false
    return !signal.aborted
  } catch { return false }
}
