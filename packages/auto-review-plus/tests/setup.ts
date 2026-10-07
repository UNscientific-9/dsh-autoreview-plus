import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterAll } from 'vitest'
const root = path.resolve('.tmp')
const directory = path.join(root, `unit-records-${randomUUID()}`)
process.env.DSH_PLUS_DATA_DIRECTORY = directory
afterAll(async () => {
  if (!directory.startsWith(root + path.sep)) throw new Error('Unsafe test cleanup path')
  await rm(directory, { recursive: true, force: true })
})
