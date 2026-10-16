import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function pluginFile(relative) {
  const local = relative.startsWith('genshin-codex/') ? path.resolve(pluginRoot, relative.slice('genshin-codex/'.length)) : ''
  if (local && fs.existsSync(local)) return local
  for (let base = pluginRoot; base && base !== path.dirname(base); base = path.dirname(base)) {
    const direct = path.resolve(base, '..', relative)
    if (fs.existsSync(direct)) return direct
    try {
      for (const child of fs.readdirSync(path.dirname(base), { withFileTypes: true })) {
        if (!child.isDirectory() || child.name === path.basename(base)) continue
        const candidate = path.resolve(path.dirname(base), child.name, relative)
        if (fs.existsSync(candidate)) return candidate
      }
    } catch {}
  }
  return ''
}
const sources = {
  gs: [
    ['miao-plugin/resources/meta-gs/character/alias.js', 'character'],
    ['miao-plugin/resources/meta-gs/weapon/alias.js', 'weapon'],
    ['miao-plugin/resources/meta-gs/artifact/alias.js', 'artifact'],
    ['genshin/defSet/role/name.yaml', 'character'],
    ['genshin/config/role.name.yaml', 'character'],
    ['atlas/resource/Forlibrary/Genshin-Atlas/othername/weapon.yaml', 'weapon'],
    ['atlas/resource/Forlibrary/Genshin-Atlas/othername/artifact.yaml', 'artifact'],
    ['genshin-codex/resources/alias/gs-weapon.yaml', 'weapon'],
    ['genshin-codex/resources/alias/gs-artifact.yaml', 'artifact'],
    ['genshin-codex/resources/alias/gs-artifact-miao.js', 'artifact'],
  ],
  sr: [
    ['genshin/defSet/role/sr_name.yaml', 'character'],
    ['miao-plugin/resources/meta-sr/character/alias.js', 'character'],
    ['miao-plugin/resources/meta-sr/weapon/alias.js', 'weapon'],
    ['miao-plugin/resources/meta-sr/artifact/alias.js', 'artifact'],
    ['StarRail-plugin/defSet/alias.yaml', 'character'],
    ['atlas/resource/Forlibrary/star-rail-atlas/othername/role.yaml', 'character'],
    ['atlas/resource/Forlibrary/star-rail-atlas/othername/lightcone.yaml', 'weapon'],
    ['atlas/resource/Forlibrary/star-rail-atlas/othername/relic.yaml', 'artifact'],
    ['genshin-codex/resources/alias/sr-role.yaml', 'character'],
    ['genshin-codex/resources/alias/sr-lightcone.yaml', 'weapon'],
    ['genshin-codex/resources/alias/sr-relic.yaml', 'artifact'],
  ],
  zzz: [
    ['ZZZ-Plugin/defSet/alias.yaml', 'character'],
    ['atlas/resource/Forlibrary/zzz-atlas/othername/role.yaml', 'character'],
    ['atlas/resource/Forlibrary/zzz-atlas/othername/音擎.yaml', 'weapon'],
    ['genshin-codex/resources/alias/zzz-character.yaml', 'character'],
    ['genshin-codex/resources/alias/zzz-role.yaml', 'character'],
    ['genshin-codex/resources/alias/zzz-engine.yaml', 'weapon'],
    ['genshin-codex/resources/alias/zzz-disk.yaml', 'artifact'],
  ],
}
const cache = new Map()

function normalize(value) {
  return String(value || '').replace(/尔/g, '儿').replace(/[【】\[\]()（）·•・\s]/g, '').toLowerCase()
}

function splitAliases(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  return String(value || '').split(/[,，、]/).map(item => item.trim()).filter(Boolean)
}

function readPairs(file) {
  const text = fs.readFileSync(file, 'utf8')
  if (file.endsWith('.yaml') || file.endsWith('.yml')) return parseYaml(text)
  const pairs = []
  for (const block of text.matchAll(/export const \w+\s*=\s*\{([\s\S]*?)\n\}/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const matched = line.match(/^\s*(?:'([^']+)'|"([^"]+)"|([^:,'"]+))\s*:\s*(['"])(.*?)\4\s*,?\s*$/)
      if (!matched) continue
      pairs.push([matched[1] || matched[2] || matched[3].trim(), splitAliases(matched[5])])
    }
  }
  return pairs
}

function parseYaml(text) {
  const pairs = []
  let name = ''
  let aliases = []
  const flush = () => {
    if (!name) return
    const official = /^\d+$/.test(name) ? (aliases[0] || '') : name
    const rest = /^\d+$/.test(name) ? aliases.slice(1) : aliases
    if (official) pairs.push([official, rest])
    name = ''
    aliases = []
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '')
    if (!line.trim()) continue
    const head = line.match(/^([^:\s][^:]*):\s*(.*)$/)
    if (head && !/^\s/.test(line)) {
      flush()
      name = head[1].trim().replace(/^['\"]|['\"]$/g, '')
      if (head[2].trim()) aliases = splitAliases(head[2])
      continue
    }
    const item = line.match(/^\s*-\s+(.+)$/)
    if (item && name) aliases.push(item[1].trim().replace(/^['\"]|['\"]$/g, ''))
  }
  flush()
  return pairs
}

function load(game) {
  const index = new Map()
  const add = (name, aliases, kind) => {
    const official = String(name || '').trim()
    if (!official) return
    for (const alias of [official, ...aliases]) {
      const key = normalize(alias)
      if (key.length < 2) continue
      if (!index.has(key)) index.set(key, [])
      const list = index.get(key)
      if (!list.some(item => item.name === official && item.kind === kind)) list.push({ name: official, kind })
    }
  }
  for (const [relative, kind] of sources[game] || []) {
    const file = pluginFile(relative)
    if (!fs.existsSync(file)) continue
    try {
      for (const [name, aliases] of readPairs(file)) add(name, aliases, kind)
    } catch (err) {
      logger?.warn?.(`[图鉴别名] ${relative} 读取失败:`, err.message || err)
    }
  }
  return index
}

function indexOf(game) {
  const cached = cache.get(game)
  if (cached) return cached
  const index = load(game)
  cache.set(game, index)
  return index
}

export function aliasNames(game, keyword) {
  const key = normalize(keyword)
  if (!key) return []
  return (indexOf(game).get(key) || []).map(item => item.name)
}

export function aliasKinds(game, keyword) {
  return [...new Set((indexOf(game).get(normalize(keyword)) || []).map(item => item.kind))]
}

export function entryPattern(game, kinds = ['character', 'weapon', 'artifact']) {
  const allowed = new Set(kinds)
  const names = new Set()
  for (const [key, items] of indexOf(game)) {
    if (items.some(item => allowed.has(item.kind))) names.add(key)
  }
  return [...names].filter(name => name.length >= 2).sort((a, b) => b.length - a.length).join('|')
}

const upcomingFiles = {
  gs: 'miao-plugin/resources/meta-gs/character/data.json',
  sr: 'miao-plugin/resources/meta-sr/character/data.json',
  zzz: 'ZZZ-Plugin/defSet/upcoming.yaml',
}
const upcomingCache = new Map()

function upcomingOf(game) {
  const cached = upcomingCache.get(game)
  if (cached) return cached
  const names = new Set()
  const file = pluginFile(upcomingFiles[game] || '')
  if (file) {
    try {
      if (file.endsWith('.json')) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        const now = Date.now()
        for (const item of Object.values(data || {})) {
          if (item?.name && item.eta && Number(item.eta) > now) names.add(item.name)
        }
      } else {
        for (const [name] of parseYaml(fs.readFileSync(file, 'utf8'))) names.add(name)
      }
    } catch (err) {
      logger?.warn?.(`[图鉴别名] ${upcomingFiles[game]} 读取失败:`, err.message || err)
    }
  }
  upcomingCache.set(game, names)
  return names
}

export function upcomingName(game, keyword) {
  const names = upcomingOf(game)
  if (!names.size) return ''
  const known = new Map()
  for (const name of names) known.set(normalize(name), name)
  for (const name of [keyword, ...aliasNames(game, keyword)]) {
    const found = known.get(normalize(name))
    if (found) return found
  }
  return ''
}

export function aliasStats() {
  return Object.fromEntries(Object.keys(sources).map(game => [game, indexOf(game).size]))
}
