import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appsDir = path.join(__dirname, 'apps')
const apps = {}

for (const file of fs.readdirSync(appsDir).filter(name => name.endsWith('.js'))) {
  const mod = await import(`./apps/${file}`)
  apps[file.replace('.js', '')] = mod.default || mod
}

export { apps }
