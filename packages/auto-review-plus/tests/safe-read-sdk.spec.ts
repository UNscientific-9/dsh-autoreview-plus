import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { safeRead, type SafeReadFileSystem } from '../src/safe-read.ts'

const root = path.resolve('.tmp', `safe-read-sdk-${randomUUID()}`)
afterAll(async () => {
  if (!root.startsWith(path.resolve('.tmp') + path.sep)) throw new Error('Unsafe cleanup')
  await rm(root, { recursive: true, force: true })
})

const cwd = 'session://workspace'
const bytes = (text: string) => new TextEncoder().encode(text)

interface FixtureTarget {
  targetKey: string
  displayPath: string
}

interface FsOptions {
  rootPath?: string
  targetPath?: string
  displayPath?: string
  targetBytes?: Uint8Array
  reportedSize?: number
  targetType?: 'file' | 'directory' | 'other'
  rootType?: 'file' | 'directory' | 'other'
  contained?: boolean
  sameTarget?: boolean
  readBytes?: (target: FixtureTarget, signal: AbortSignal | undefined, maxBytes: number) => Promise<Uint8Array>
}

function filesystem(options: FsOptions = {}) {
  const rootTarget: FixtureTarget = { targetKey: 'workspace-key', displayPath: 'workspace-relative' }
  const target: FixtureTarget = {
    targetKey: options.sameTarget ? rootTarget.targetKey : 'file-key',
    displayPath: options.displayPath ?? 'workspace-relative/note.txt',
  }
  const rootPath = options.rootPath ?? '/execution/workspace'
  const targetPath = options.targetPath ?? '/execution/workspace/note.txt'
  const service = {
    resolve: vi.fn(async (requestedPath: string) => requestedPath === '.' ? rootTarget : target),
    contains: vi.fn((parent: FixtureTarget, child: FixtureTarget) => (
      parent.targetKey === rootTarget.targetKey && child.targetKey !== rootTarget.targetKey && options.contained !== false
    )),
    stat: vi.fn(async (value: FixtureTarget) => value.targetKey === rootTarget.targetKey
      ? { type: options.rootType ?? 'directory' as const }
      : options.targetType === undefined ? { type: 'file' as const, ...(options.reportedSize === undefined ? {} : { size: options.reportedSize }) }
        : { type: options.targetType, ...(options.reportedSize === undefined ? {} : { size: options.reportedSize }) }),
    processPath: vi.fn((value: FixtureTarget) => value.targetKey === rootTarget.targetKey ? rootPath : targetPath),
    readBytes: vi.fn(async (value: FixtureTarget, signal: AbortSignal | undefined, maxBytes: number) => (
      options.readBytes === undefined ? options.targetBytes ?? bytes('ordinary project note') : options.readBytes(value, signal, maxBytes)
    )),
  } as unknown as SafeReadFileSystem
  return { fs: service, rootTarget, target }
}

function snapshot(filePath = 'note.txt', snapshotCwd = cwd) {
  return {
    cwd: snapshotCwd,
    projectInstructions: [],
    history: [],
    action: { name: 'read', arguments: { file_path: filePath } },
  }
}

describe('safe read through the host filesystem service', () => {
  it('uses provider-resolved content instead of a same-named host file and passes the session cwd', async () => {
    const hostCwd = path.join(root, 'host-workspace')
    await mkdir(hostCwd, { recursive: true })
    await writeFile(path.join(hostCwd, 'note.txt'), '-----BEGIN ' + 'PRIVATE KEY----- host-only secret')
    const controller = new AbortController()
    const { fs } = filesystem({ displayPath: 'file:///provider/workspace/note.txt' })

    expect(await safeRead(snapshot('note.txt', hostCwd), true, fs, controller.signal)).toBe(true)
    expect(fs.resolve).toHaveBeenNthCalledWith(1, '.', { cwd: hostCwd, signal: controller.signal })
    expect(fs.resolve).toHaveBeenNthCalledWith(2, 'note.txt', { cwd: hostCwd, signal: controller.signal })
    expect(fs.readBytes).toHaveBeenCalledWith(expect.anything(), controller.signal, 128 * 1024)
  })

  it('fails closed when the service is absent or a required capability is missing', async () => {
    const controller = new AbortController()
    expect(await safeRead(snapshot(), true, undefined, controller.signal)).toBe(false)
    const incomplete = { resolve: vi.fn() } as unknown as SafeReadFileSystem
    expect(await safeRead(snapshot(), true, incomplete, controller.signal)).toBe(false)
    expect(incomplete.resolve).not.toHaveBeenCalled()
  })

  it('rejects traversal and a symlink whose provider-resolved target escapes the workspace', async () => {
    const controller = new AbortController()
    for (const requestedPath of ['../outside.txt', 'outside-link/outside.txt']) {
      const { fs } = filesystem({ targetPath: '/execution/outside.txt', contained: false })
      expect(await safeRead(snapshot(requestedPath), true, fs, controller.signal)).toBe(false)
      expect(fs.contains).toHaveBeenCalledOnce()
      expect(fs.readBytes).not.toHaveBeenCalled()
    }
  })

  it('checks resolved sensitive path segments and supported text extensions', async () => {
    const controller = new AbortController()
    const sensitive = filesystem({ targetPath: '/execution/workspace/credentials/note.txt' })
    expect(await safeRead(snapshot(), true, sensitive.fs, controller.signal)).toBe(false)
    const unsupported = filesystem({ targetPath: '/execution/workspace/note.pdf' })
    expect(await safeRead(snapshot(), true, unsupported.fs, controller.signal)).toBe(false)
    expect(sensitive.fs.readBytes).not.toHaveBeenCalled()
    expect(unsupported.fs.readBytes).not.toHaveBeenCalled()
  })

  it('rejects secret-shaped or binary bytes returned by the provider', async () => {
    const controller = new AbortController()
    const secret = filesystem({ targetBytes: bytes('password = "fixture-secret"') })
    expect(await safeRead(snapshot(), true, secret.fs, controller.signal)).toBe(false)
    const cookie = filesystem({ targetBytes: bytes('Cookie: sid=fixture-session; csrf=fixture-csrf') })
    expect(await safeRead(snapshot(), true, cookie.fs, controller.signal)).toBe(false)
    const binary = filesystem({ targetBytes: new Uint8Array([65, 0, 66]) })
    expect(await safeRead(snapshot(), true, binary.fs, controller.signal)).toBe(false)
  })

  it('enforces the byte cap from metadata and again on returned bytes when size is unknown', async () => {
    const controller = new AbortController()
    const knownLarge = filesystem({ reportedSize: 128 * 1024 + 1 })
    expect(await safeRead(snapshot(), true, knownLarge.fs, controller.signal)).toBe(false)
    expect(knownLarge.fs.readBytes).not.toHaveBeenCalled()

    const unknownLarge = filesystem({ targetBytes: new Uint8Array(128 * 1024 + 1) })
    expect(await safeRead(snapshot(), true, unknownLarge.fs, controller.signal)).toBe(false)
    expect(unknownLarge.fs.readBytes).toHaveBeenCalledWith(expect.anything(), controller.signal, 128 * 1024)

    const unknownBounded = filesystem({ targetBytes: new Uint8Array(128 * 1024).fill(65) })
    expect(await safeRead(snapshot(), true, unknownBounded.fs, controller.signal)).toBe(true)
  })

  it('uses process paths across POSIX and Windows and rejects relative or URI process paths', async () => {
    const controller = new AbortController()
    const posix = filesystem({ rootPath: '/exec/work', targetPath: '/exec/work/sub/note.txt', displayPath: 'relative/sub/note.txt' })
    expect(await safeRead(snapshot(), true, posix.fs, controller.signal)).toBe(true)

    const windows = filesystem({ rootPath: 'C:\\exec\\work', targetPath: 'C:\\exec\\work\\sub\\note.txt', displayPath: 'repo/sub/note.txt' })
    expect(await safeRead(snapshot(), true, windows.fs, controller.signal)).toBe(true)

    const relative = filesystem({ targetPath: 'repo/note.txt' })
    expect(await safeRead(snapshot(), true, relative.fs, controller.signal)).toBe(false)
    const uri = filesystem({ targetPath: 'file:///exec/work/note.txt' })
    expect(await safeRead(snapshot(), true, uri.fs, controller.signal)).toBe(false)
  })

  it('rejects an invalid workspace root and a target equal to that root', async () => {
    const controller = new AbortController()
    const badRoot = filesystem({ rootType: 'file' })
    expect(await safeRead(snapshot(), true, badRoot.fs, controller.signal)).toBe(false)
    const same = filesystem({ sameTarget: true })
    expect(await safeRead(snapshot(), true, same.fs, controller.signal)).toBe(false)
    expect(same.fs.contains).not.toHaveBeenCalled()
  })

  it('threads cancellation through filesystem I/O and rejects an in-flight result after abort', async () => {
    const controller = new AbortController()
    const fs = filesystem({
      readBytes: async (_target, signal, maxBytes) => {
        expect(signal).toBe(controller.signal)
        expect(maxBytes).toBe(128 * 1024)
        controller.abort()
        return bytes('ordinary project note')
      },
    })
    expect(await safeRead(snapshot(), true, fs.fs, controller.signal)).toBe(false)
    expect(fs.fs.resolve).toHaveBeenCalledWith('note.txt', { cwd, signal: controller.signal })
    expect(fs.fs.stat).toHaveBeenLastCalledWith(fs.target, controller.signal)
  })

  it('rejects before I/O when already cancelled or the root cannot be resolved', async () => {
    const cancelled = new AbortController()
    cancelled.abort()
    const { fs } = filesystem()
    expect(await safeRead(snapshot(), true, fs, cancelled.signal)).toBe(false)
    expect(fs.resolve).not.toHaveBeenCalled()

    const missingRoot = filesystem()
    vi.mocked(missingRoot.fs.resolve).mockRejectedValueOnce(new Error('missing workspace'))
    expect(await safeRead(snapshot(), true, missingRoot.fs, new AbortController().signal)).toBe(false)
    expect(missingRoot.fs.readBytes).not.toHaveBeenCalled()
  })
})
