import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.join(__dirname, '..')
const configFile = path.join(__dirname, 'config.json')

export const defaultConfig = {
  backgroundPath: 'resources/background/bg.png',
  containerOpacity: 0.72,
  blur: 6,
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

function normalizeConfig(config = {}) {
  return {
    ...defaultConfig,
    ...config,
    backgroundPath: String(config.backgroundPath ?? defaultConfig.backgroundPath).trim(),
    containerOpacity: clampNumber(config.containerOpacity, 0, 1, defaultConfig.containerOpacity),
    blur: clampNumber(config.blur, 0, 30, defaultConfig.blur),
  }
}

export function getWikiConfig() {
  try {
    if (!fs.existsSync(configFile)) return { ...defaultConfig }
    return normalizeConfig(JSON.parse(fs.readFileSync(configFile, 'utf-8') || '{}'))
  } catch {
    return { ...defaultConfig }
  }
}

export function resolvePluginPath(inputPath) {
  const raw = String(inputPath || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw) || /^file:\/\//i.test(raw)) return raw
  if (path.isAbsolute(raw)) return raw
  return path.join(pluginRoot, raw)
}
