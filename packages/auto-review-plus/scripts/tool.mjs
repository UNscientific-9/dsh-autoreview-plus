import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const [tool, ...args] = process.argv.slice(2)
const packageName = tool === 'tsc' ? 'typescript' : tool
const packagePath = require.resolve(`${packageName}/package.json`)
const pkg = require(packagePath)
const entry = path.resolve(path.dirname(packagePath), typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[tool])
process.argv = [process.execPath, entry, ...args]
await import(pathToFileURL(entry).href)
