const LIST_BASE = 'https://act-api-takumi-static.mihoyo.com'
const ENTRY_BASE = 'https://api-takumi-static.mihoyo.com'
const API_BASE = 'https://act-api-takumi.mihoyo.com'
const APP_SN = 'ys_obc'

const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  referer: 'https://baike.mihoyo.com/',
  origin: 'https://baike.mihoyo.com',
  'x-rpc-language': 'zh-cn',
}

const CACHE_TTL = 30 * 60 * 1000
const LIST_TTL = 6 * 60 * 60 * 1000

export const WIKI_PAGE_SIZE = 5

export const WIKI_CHANNELS = [
  { id: 25, name: '角色', aliases: ['角色', '人物'] },
  { id: 5, name: '武器', aliases: ['武器'] },
  { id: 218, name: '圣遗物', aliases: ['圣遗物', '遗物', '圣遗'] },
  { id: 6, name: '敌人', aliases: ['敌人', '怪物', '魔物'] },
  { id: 21, name: '食物', aliases: ['食物', '料理', '食谱'] },
  { id: 13, name: '背包', aliases: ['材料', '素材', '道具', '背包'] },
]

const cache = {
  entries: new Map(),
  lists: new Map(),
  searches: new Map(),
}

const fetchCompat = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args)
  return import('node-fetch').then(mod => mod.default(...args))
}

export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<span[^>]*class="wiki-note-text"[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<span[^>]*class="name"[^>]*>([\s\S]*?)<\/span>/gi, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/(div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[：:\s]+/, '')
    .trim()
}

export function clipText(value, max = 420) {
  const text = String(value || '').trim()
  if (text.length <= max) return text
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…'
}

function parseJson(value, fallback = null) {
  if (!value) return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeName(value) {
  return stripHtml(value).replace(/[【】\[\]()（）·\s]/g, '').toLowerCase()
}

async function requestJson(url) {
  const res = await fetchCompat(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`观测枢请求失败: ${res.status}`)
  const json = await res.json()
  if (json?.retcode !== 0) throw new Error(json?.message || '观测枢返回异常')
  return json.data
}

export function findWikiChannel(keyword) {
  const text = String(keyword || '').trim()
  if (!text) return null
  return WIKI_CHANNELS.find(channel => channel.name === text || channel.aliases.includes(text)) || null
}

async function getChannelItems(channelId) {
  const cached = cache.lists.get(channelId)
  if (cached && Date.now() - cached.time < LIST_TTL) return cached.items

  const data = await requestJson(`${LIST_BASE}/common/blackboard/${APP_SN}/v1/home/content/list?app_sn=${APP_SN}&channel_id=${channelId}`)
  const items = []
  for (const channel of data?.list || []) {
    for (const item of channel.list || []) {
      if (!item?.content_id || !item?.title) continue
      items.push({
        id: String(item.content_id),
        name: item.title,
        icon: item.icon || '',
        summary: stripHtml(item.summary || ''),
        alias: stripHtml(item.alias_name || ''),
        channelId,
        channelName: channel.name || '',
      })
    }
  }
  cache.lists.set(channelId, { time: Date.now(), items })
  return items
}

async function searchRemote(keyword) {
  const key = normalizeName(keyword)
  const cached = cache.searches.get(key)
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.items

  const data = await requestJson(`${API_BASE}/hoyowiki/wapi/search?keyword=${encodeURIComponent(keyword)}&app_sn=${APP_SN}&lang=zh-cn&page_size=10`)
  const items = (data?.list || []).map(item => ({
    id: String(item.entry_page_id),
    name: stripHtml(item.name),
    icon: item.icon_url || '',
    channelName: item.menus?.[0]?.name || '',
    channelId: Number(item.menus?.[0]?.id || 0),
  })).filter(item => item.id && item.name)

  cache.searches.set(key, { time: Date.now(), items })
  return items
}

const CARD_CHANNELS = new Set(['行动牌', '角色牌', '名片', '装扮', '角色视频'])

function scoreItem(item, keyword) {
  const query = normalizeName(keyword)
  const name = normalizeName(item.name)
  const alias = normalizeName(item.alias)
  if (!query || !name) return 0

  const rank = value => {
    if (!value) return 0
    if (value === query) return 100
    if (value.startsWith(query)) return 80
    if (value.includes(query)) return 60
    if (query.includes(value) && value.length >= 2) return 40
    return 0
  }

  let score = Math.max(rank(name), rank(alias))
  if (!score && query.length >= 2 && [...query].every(char => name.includes(char))) score = 50
  if (!score) return 0
  if (CARD_CHANNELS.has(item.channelName) && score >= 95) score -= 5
  return score
}

export async function searchWiki(keyword, { channelId = 0, limit = 8 } = {}) {
  const text = String(keyword || '').trim()
  if (!text) return []

  const collected = new Map()
  const add = item => {
    if (!item?.id) return
    const prev = collected.get(item.id)
    if (!prev || scoreItem(item, text) > scoreItem(prev, text)) collected.set(item.id, item)
  }

  if (channelId) {
    for (const item of await getChannelItems(channelId)) add(item)
  } else {
    try {
      for (const item of await searchRemote(text)) add(item)
    } catch (err) {
      logger.warn('[观测枢图鉴] 搜索接口失败，改用图鉴目录:', err.message || err)
    }
  }

  let results = [...collected.values()]
    .map(item => ({ ...item, score: scoreItem(item, text) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)

  if (!results.length && !channelId) {
    const lists = await Promise.all(WIKI_CHANNELS.map(channel => getChannelItems(channel.id).catch(() => [])))
    for (const items of lists) items.forEach(add)
    results = [...collected.values()]
      .map(item => ({ ...item, score: scoreItem(item, text) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
  }

  return results.slice(0, limit)
}

export async function listWikiChannel(channel, page = 1) {
  const items = await getChannelItems(channel.id)
  const size = 24
  const totalPage = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(Math.max(1, page), totalPage)
  const start = (current - 1) * size
  return {
    channel,
    page: current,
    totalPage,
    total: items.length,
    items: items.slice(start, start + size),
  }
}

export function parseWikiQuery(input = '') {
  const tokens = String(input).trim().split(/\s+/).filter(Boolean)
  let page = 1
  let channel = null
  const words = []

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      page = Math.max(1, parseInt(token, 10))
      continue
    }
    const matched = findWikiChannel(token)
    if (matched && !channel) {
      channel = matched
      continue
    }
    words.push(token)
  }

  return { page, channel, keyword: words.join(' ') }
}

function materialsFromHtml(value) {
  const html = String(value ?? '')
  const tagged = [...html.matchAll(/data-entry-name="([^"]+)"[^>]*data-entry-amount="([^"]*)"/g)]
    .map(match => `${match[1]}${match[2] ? '×' + match[2] : ''}`)
  if (tagged.length) return tagged
  return [...html.matchAll(/<span class="name">([^<]+)<\/span>[\s\S]*?<span class="amount">\*?(\d+)<\/span>/g)]
    .map(match => `${match[1]}×${match[2]}`)
}

function valuesOf(attr) {
  return (attr?.value || []).flatMap(value => {
    const materials = materialsFromHtml(value)
    return materials.length ? [materials.join('、')] : [stripHtml(value)]
  }).filter(Boolean)
}

function filtersOf(page) {
  const ext = parseJson(page?.ext?.fe_ext, {})
  const raw = ext?.c_5?.filter?.text || ext?.c_5?.filter?.value || []
  const list = typeof raw === 'string' ? parseJson(raw, []) : raw
  return Array.isArray(list) ? list.filter(Boolean) : []
}

function pushSection(sections, title, lines, collapse = false, groups = [], total = []) {
  const content = (Array.isArray(lines) ? lines : [lines]).map(line => String(line || '').trim()).filter(Boolean)
  const materialGroups = (groups || []).filter(group => group.materials?.length)
  if (!content.length && !materialGroups.length) return
  sections.push({
    title: title || '详情',
    text: clipText(content.join('\n'), collapse ? 520 : 900),
    groups: materialGroups,
    total: total || [],
  })
}

function materialItems(items) {
  return (items || []).filter(item => item?.nickname).map(item => ({
    name: item.nickname,
    amount: item.amount || '',
    icon: item.img || '',
  }))
}

function attrPairs(attrs, limit = 8) {
  return (attrs || []).map(attr => ({
    key: stripHtml(attr.key).replace(/[：:\s]+$/g, ''),
    value: valuesOf(attr).join('、'),
  })).filter(attr => attr.key && attr.value).slice(0, limit)
}

function parseGrowth(data) {
  const levels = (data?.list || []).map(level => {
    const materials = materialItems(level.materials)
    const attrs = attrPairs(level.attr, 4)
    if (!materials.length && !attrs.length) return null
    return {
      name: level.tab_name || '等级',
      materials,
      note: attrs.map(attr => `${attr.key} ${attr.value}`).join('；'),
      summary: /初始|合计|所需材料/.test(level.tab_name || '') || materials.length > 8,
    }
  }).filter(Boolean)
  return {
    rows: levels.filter(level => !level.summary && level.materials.length),
    total: levels.find(level => level.summary)?.materials || [],
    notes: levels.filter(level => !level.materials.length).map(level => [level.name, level.note].filter(Boolean).join('：')),
  }
}

function parseAscension(data) {
  const levels = data?.list || []
  const rows = levels.filter(level => (level.materials || []).length).map(level => ({
    name: level.tab_name || '突破',
    materials: materialItems(level.materials),
  }))
  const total = levels.find(level => /突破所需材料/.test(level.tab_name || '') && (level.materials || []).length)
  return { rows, total: total ? materialItems(total.materials) : [] }
}

function parseTalent(data) {
  const talents = []
  let materials = []
  for (const item of data?.list || []) {
    const title = [item.tab_name, item.title].filter(Boolean).join(' · ')
    const desc = clipText(stripHtml(item.desc), 90)
    if (title || desc) talents.push([title, desc].filter(Boolean).join('：'))

    const table = item.attr || {}
    const row = (table.row || []).find(cells => /升级材料/.test(cellText(cells?.[0])))
    if (!row || materials.length) continue
    const header = table.header || []
    materials = row.slice(1).map((cell, index) => {
      const items = materialsFromHtml(cell).map(label => {
        const matched = label.match(/^(.*?)(?:×(\d+))?$/)
        return { name: matched?.[1] || label, amount: matched?.[2] || '', icon: '' }
      })
      return items.length ? { name: header[index + 1] || `LV${index + 1}`, materials: items } : null
    }).filter(Boolean)
  }
  return { talents, materials }
}

function cellText(cell) {
  if (cell == null) return ''
  if (typeof cell === 'string' || typeof cell === 'number') return stripHtml(cell)
  return stripHtml(cell.value || cell.text || cell.name || cell.title || '')
}

function parseTables(data) {
  const lines = []
  for (const table of (data?.tables || []).slice(0, 2)) {
    const title = stripHtml(table?.tab_name || table?.title || table?.name || '')
    if (title && title !== '默认标题') lines.push(title)
    const rows = table?.row || table?.rows || table?.list || table?.data || []
    for (const row of rows.slice(0, 6)) {
      const cells = Array.isArray(row) ? row : (row?.cells || row?.value || row?.attr || row?.columns)
      const text = Array.isArray(cells)
        ? cells.map(cellText).filter(Boolean).join('：')
        : cellText(row)
      if (text) lines.push(text)
    }
  }
  return lines
}

function parseArtifact(data, moduleName) {
  const name = valuesOf(data?.name).join('') || stripHtml(data?.title)
  const desc = valuesOf(data?.desc).join('')
  return [name && `${moduleName || '部件'}：${name}`, desc].filter(Boolean)
}

function parseComponent(component, moduleName) {
  const data = parseJson(component?.data, {})
  const id = component?.component_id || ''
  const title = moduleName || '详情'

  if (id === 'material_base_info') {
    const recipe = materialsFromHtml(data?.materials?.value || '').map(label => {
      const matched = label.match(/^(.*?)(?:×(\d+))?$/)
      return { name: matched?.[1] || label, amount: matched?.[2] || '', icon: '' }
    })
    return {
      title: data.name || title,
      lines: attrPairs(data.attr, 6).map(attr => `${attr.key}：${attr.value}`),
      groups: recipe.length ? [{ name: '加工材料', materials: recipe }] : [],
    }
  }
  if (/base_info/.test(id)) return null
  if (id === 'good_desc') {
    const attrs = attrPairs(data?.attr, 6).map(attr => `${attr.key}：${attr.value}`)
    return { title, lines: [stripHtml(data?.rich_text), ...attrs].filter(Boolean) }
  }
  if (id === 'equipment_growth_info') {
    const parsed = parseGrowth(data)
    return { title, lines: parsed.notes, groups: parsed.rows, total: parsed.total }
  }
  if (id === 'role_ascension') {
    const parsed = parseAscension(data)
    const groups = parsed.rows.filter(row => !/所需材料/.test(row.name))
    return { title, lines: [], groups, total: parsed.total }
  }
  if (id === 'role_talent') {
    const parsed = parseTalent(data)
    return { title, lines: parsed.talents, groups: parsed.materials }
  }
  if (id === 'multi_table' || id === 'recommend') return { title, lines: parseTables(data) }
  if (id === 'artifact_list_v2') return { title: '圣遗物件', lines: parseArtifact(data, moduleName) }
  if (id === 'rich_base_info') {
    return { title, lines: attrPairs(data?.list || data?.attr, 8).map(attr => `${attr.key}：${attr.value}`) }
  }
  if (id === 'collapse_panel' || id === 'rich_text') {
    return { title, lines: [stripHtml(data?.rich_text)], collapse: true }
  }
  if (['map_desc', 'role_voice', 'strategy', 'business_card', 'timeline_base_info', 'interactive_dialogue', 'card_group_info'].includes(id)) {
    return null
  }
  if (data?.rich_text) return { title, lines: [stripHtml(data.rich_text)], collapse: true }
  return null
}

function headerFrom(page) {
  const filters = filtersOf(page)
  let base = null
  for (const module of page?.modules || []) {
    for (const component of module.components || []) {
      if (!/base_info/.test(component.component_id || '')) continue
      const data = parseJson(component.data, {})
      if (data?.name || data?.star || data?.attr || data?.image) {
        base = data
        break
      }
    }
    if (base) break
  }

  const data = base || {}
  const tags = []
  if (data.star) tags.push(`${data.star}星`)
  for (const field of ['category', 'weapon_type', 'element']) {
    if (data[field]) tags.push(String(data[field]))
  }
  for (const filter of filters) {
    const [group, label] = String(filter).split('/')
    const text = /星级|星/.test(group) && label && !/星/.test(label) ? `${label}星` : label
    if (text && !tags.includes(text)) tags.push(text)
  }

  const attrs = attrPairs(data.attr, 8)
  const drops = materialItems(data.feedback || data.drops || [])
  if (drops.length) attrs.push({ key: '掉落', value: drops.map(item => item.name).join('、') })

  const ext = parseJson(page?.ext?.fe_ext, {})
  for (const row of Object.values(ext).flatMap(item => item?.table?.list || [])) {
    const key = stripHtml(row.key).replace(/[：:\s]+$/g, '')
    const value = stripHtml(row.value)
    if (key && value) attrs.push({ key, value })
  }

  return {
    icon: data.image || data.avatar_pc || data.avatar_m || page.icon_url || '',
    tags: tags.slice(0, 8),
    attrs: attrs.slice(0, 8),
  }
}

const PRIORITY = ['装备描述', '基础信息', '物品描述', '基础属性', '圣遗物件', '成长数值', '角色突破', '推荐装备', '天赋', '命之座', '推荐角色', '特殊料理']

export function formatWikiEntry(page) {
  if (!page?.id) return null
  const header = headerFrom(page)
  const sections = []
  const seen = new Set()
  const pending = []

  for (const module of page.modules || []) {
    if (module.is_hidden) continue
    for (const component of module.components || []) {
      const parsed = parseComponent(component, module.name)
      if (!parsed?.lines?.length && !parsed?.groups?.length) continue
      pending.push(parsed)
    }
  }

  pending.sort((a, b) => {
    const ai = PRIORITY.indexOf(a.title)
    const bi = PRIORITY.indexOf(b.title)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })

  for (const parsed of pending) {
    const key = parsed.title + parsed.lines.join('\n')
    if (seen.has(parsed.title) || seen.has(key)) continue
    seen.add(parsed.title)
    seen.add(key)
    const lines = parsed.title === '圣遗物件' ? parsed.lines.slice(0, 2) : parsed.lines
    pushSection(sections, parsed.title, lines, parsed.collapse, parsed.groups, parsed.total)
    if (sections.length >= 5) break
  }

  return {
    id: String(page.id),
    name: page.name || '未命名词条',
    icon: header.icon,
    tags: header.tags,
    attrs: header.attrs,
    sections,
    url: `https://baike.mihoyo.com/ys/obc/content/${page.id}/detail?bbs_presentation_style=no_header`,
  }
}

export async function getWikiEntry(id) {
  const key = String(id || '')
  const cached = cache.entries.get(key)
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.entry

  const data = await requestJson(`${ENTRY_BASE}/hoyowiki/genshin/wapi/entry_page?app_sn=${APP_SN}&entry_page_id=${encodeURIComponent(key)}&lang=zh-cn`)
  const entry = formatWikiEntry(data?.page)
  if (!entry) throw new Error('词条内容为空')
  cache.entries.set(key, { time: Date.now(), entry })
  return entry
}

