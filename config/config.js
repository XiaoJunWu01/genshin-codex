import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.join(__dirname, '..')
const configFile = path.join(__dirname, 'config.json')

export const defaultConfig = {
  backgroundPath: 'resources/background/bg.png',
  theme: 'miao',
  columns: 3,
  glass: true,
  containerOpacity: 0.22,
  blur: 12,
  titleColor: '#ffffff',
  commandColor: '#fff3cf',
  textColor: '#ffffff',
  fontFamily: 'Microsoft YaHei',
}

function colorOf(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? value : fallback
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
    theme: ['miao', 'light', 'glass'].includes(config.theme) ? config.theme : defaultConfig.theme,
    columns: [2, 3, 4].includes(Number(config.columns)) ? Number(config.columns) : defaultConfig.columns,
    glass: config.glass !== false,
    containerOpacity: clampNumber(config.containerOpacity, 0, 1, defaultConfig.containerOpacity),
    blur: clampNumber(config.blur, 0, 30, defaultConfig.blur),
    titleColor: colorOf(config.titleColor, defaultConfig.titleColor),
    commandColor: colorOf(config.commandColor, defaultConfig.commandColor),
    textColor: colorOf(config.textColor, defaultConfig.textColor),
    fontFamily: String(config.fontFamily || defaultConfig.fontFamily).slice(0, 80),
  }
}

export function saveWikiConfig(config) {
  const next = normalizeConfig(config)
  fs.writeFileSync(configFile, JSON.stringify(next, null, 2))
  return next
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
