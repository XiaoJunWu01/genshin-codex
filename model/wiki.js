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
    .replace(/<li[^>]*>/gi, '\n· ')
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

export const WIKI_FOCUS = [
  { id: 'talent', name: '天赋', aliases: ['天赋', '技能'] },
  { id: 'constellation', name: '命座', aliases: ['命座', '命之座', '星座'] },
  { id: 'ascension', name: '突破', aliases: ['突破', '突破材料', '材料'] },
  { id: 'story', name: '故事', aliases: ['故事', '背景', '简介', '介绍'] },
  { id: 'profile', name: '资料', aliases: ['资料', '属性', '档案', '信息'] },
]

export function findWikiFocus(keyword) {
  const text = String(keyword || '').trim()
  if (!text) return null
  return WIKI_FOCUS.find(focus => focus.id === text || focus.aliases.includes(text)) || null
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

function attrValue(html, name) {
  return html.match(new RegExp(`data-${name}="([^"]*)"`))?.[1] || ''
}

function entriesFromHtml(value) {
  const html = String(value ?? '')
  const entries = []
  const seen = new Set()
  let guard = 0
  for (const match of html.matchAll(/data-entry-name="([^"]+)"/g)) {
    guard += 1
    if (guard > 30) break
    const name = stripHtml(match[1])
    if (!name || seen.has(`${name}:${match.index}`)) continue
    seen.add(`${name}:${match.index}`)
    const start = html.lastIndexOf('<', match.index)
    const end = html.indexOf('data-entry-name=', match.index + 1)
    const block = html.slice(start < 0 ? match.index : start, end < 0 ? html.length : end)
    entries.push({
      name,
      icon: attrValue(block, 'entry-img'),
      amount: attrValue(block, 'entry-amount'),
    })
  }
  if (entries.length) return entries

  return [...html.matchAll(/<img[^>]+src="([^"]+)"[\s\S]*?<span class="name">([^<]+)<\/span>(?:[\s\S]*?<span class="amount">\*?(\d+)<\/span>)?/g)]
    .map(match => ({ name: stripHtml(match[2]), icon: match[1] || '', amount: match[3] || '' }))
    .filter(item => item.name)
}

function materialsFromHtml(value) {
  return entriesFromHtml(value).map(item => `${item.name}${item.amount ? '×' + item.amount : ''}`)
}

function valuesOf(attr) {
  return (attr?.value || []).flatMap(value => {
    const materials = materialsFromHtml(value)
    return materials.length ? [materials.join('、')] : [stripHtml(value)]
  }).filter(Boolean)
}

function filtersOf(page) {
  const ext = parseJson(page?.ext?.fe_ext, {})
  const lists = Object.values(ext).map(item => item?.filter?.text || item?.filter?.value || [])
  return lists.flatMap(raw => {
    const list = typeof raw === 'string' ? parseJson(raw, []) : raw
    return Array.isArray(list) ? list.filter(Boolean) : []
  })
}

function pushSection(sections, title, lines, collapse = false, groups = [], total = [], cards = []) {
  const content = (Array.isArray(lines) ? lines : [lines]).map(line => String(line || '').trim()).filter(Boolean)
  const materialGroups = (groups || []).filter(group => group.materials?.length)
  const cardItems = (cards || []).filter(card => card?.name || card?.text)
  if (!content.length && !materialGroups.length && !cardItems.length) return
  const limit = collapse ? 1800 : 4000
  sections.push({
    title: title || '详情',
    text: content.join('\n').length > limit ? clipText(content.join('\n'), limit) : content.join('\n'),
    groups: materialGroups,
    total: total || [],
    cards: cardItems,
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
    const desc = stripHtml(item.desc)
    if (title || desc) {
      talents.push({
        name: title,
        text: desc,
        icon: item.icon || '',
      })
    }

    const table = item.attr || {}
    const row = (table.row || []).find(cells => /升级材料/.test(cellText(cells?.[0])) && cells.slice(1).some(cell => entriesFromHtml(cell).length))
    if (!row || materials.length) continue
    const header = table.header || []
    materials = row.slice(1).map((cell, index) => {
      const items = entriesFromHtml(cell)
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

function imagesFromHtml(value) {
  const html = String(value ?? '')
  const tagged = [...html.matchAll(/data-image-url="([^"]+)"/g)].map(match => match[1])
  const images = tagged.length ? tagged : [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(match => match[1])
  return [...new Set(images.filter(Boolean))]
}

function splitConstellations(html) {
  const text = String(html ?? '')
  if (text.includes('data-entry-name')) return []
  const marks = [...text.matchAll(/<img[^>]+>/g)]
  if (marks.length < 2) return []
  return marks.map((mark, index) => {
    const start = mark.index
    const end = marks[index + 1]?.index ?? text.length
    const block = text.slice(start, end)
    const plain = stripHtml(block)
    const title = plain.split('\n').find(Boolean) || ''
    return {
      name: title,
      icon: imagesFromHtml(block)[0] || '',
      text: plain.slice(title.length).trim(),
    }
  }).filter(item => item.name)
}

function parseTables(data) {
  const lines = []
  const cards = []
  for (const table of (data?.tables || []).slice(0, 2)) {
    const title = stripHtml(table?.tab_name || table?.title || table?.name || '')
    const rows = table?.row || table?.rows || table?.list || table?.data || []
    const visual = rows.some(row => {
      const cells = Array.isArray(row) ? row : []
      return entriesFromHtml(cells[0]).length || imagesFromHtml(cells[0]).length
    })
    if (!visual) {
      if (title && title !== '默认标题') lines.push(title)
      for (const row of rows.slice(0, 6)) {
        const cells = Array.isArray(row) ? row : (row?.cells || row?.value || row?.attr || row?.columns)
        const text = Array.isArray(cells)
          ? cells.map(cellText).filter(Boolean).join('：')
          : cellText(row)
        if (text) lines.push(text)
      }
      continue
    }

    const limit = /推荐/.test(title) ? 6 : 8
    let shown = 0
    for (const row of rows) {
      if (shown >= limit) break
      const cells = Array.isArray(row) ? row : []
      const label = cellText(cells[0])
      if (/成长数据/.test(label)) continue
      shown += 1
      const reason = cells.slice(1).map(cellText).filter(Boolean).join('\n')
      const constellations = splitConstellations(cells[0])
      if (constellations.length > 1) {
        constellations.forEach(item => cards.push(item))
        continue
      }
      const entries = entriesFromHtml(cells[0])
      const images = imagesFromHtml(cells[0])
      if (entries.length > 1) {
        const separator = stripHtml(cells[0]).includes('/') ? ' / ' : ' + '
        cards.push({
          group: title,
          name: entries.map(entry => entry.name).join(separator),
          icons: entries.map(entry => entry.icon).filter(Boolean),
          text: reason,
        })
      } else if (entries.length) {
        cards.push({
          group: title,
          name: entries[0].name,
          icon: entries[0].icon,
          text: reason,
        })
      } else if (images.length === 1 && !/成长数据/.test(label)) {
        const text = cellText(cells[0])
        cards.push({
          group: title,
          name: text,
          icon: images[0],
          text: reason,
        })
      } else {
        const text = cells.map(cellText).filter(Boolean).join('：')
        if (text && !/成长数据/.test(text)) cards.push({ group: title, name: text })
      }
    }
  }
  return { lines, cards }
}

function parseArtifact(data, moduleName) {
  const name = valuesOf(data?.name).join('') || stripHtml(data?.title)
  const slot = stripHtml(moduleName || data?.title).replace(/[：:]+$/g, '')
  const desc = valuesOf(data?.desc).join('')
  if (!name && !desc) return null
  return {
    name: slot && name ? `${slot} · ${name}` : (name || slot),
    icon: data?.icon_url || '',
    text: desc,
  }
}

function parseComponent(component, moduleName) {
  const data = parseJson(component?.data, {})
  const id = component?.component_id || ''
  const title = moduleName || '详情'

  if (id === 'material_base_info') {
    const recipe = entriesFromHtml(data?.materials?.value || '')
    return {
      title: data.name || title,
      lines: attrPairs(data.attr, 6).map(attr => `${attr.key}：${attr.value}`),
      groups: recipe.length ? [{ name: '加工材料', materials: recipe }] : [],
    }
  }
  if (/base_info/.test(id) && id !== 'rich_base_info') {
    const lines = attrPairs(data?.attr, 8).map(attr => `${attr.key}：${attr.value}`)
    return lines.length ? { title: '基础资料', lines } : null
  }
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
    return { title, lines: [], cards: parsed.talents, groups: parsed.materials }
  }
  if (id === 'multi_table' || id === 'recommend') {
    if (/演示/.test(title)) return null
    const parsed = parseTables(data)
    return { title, lines: parsed.lines, cards: parsed.cards }
  }
  if (id === 'artifact_list_v2') {
    const card = parseArtifact(data, moduleName)
    return card ? { title: '圣遗物件', lines: [], cards: [card] } : null
  }
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

function coverIcon(data, page) {
  const square = page?.icon_url || ''
  const portrait = data?.image || ''
  const banner = data?.avatar_pc || data?.avatar_m || ''
  if (portrait && !banner) return portrait
  return square || portrait || banner
}

const ELEMENT_COLORS = {
  风: '#378383',
  火: '#B8584B',
  水: '#518ABB',
  雷: '#6455A6',
  冰: '#5FACC1',
  岩: '#C09257',
  草: '#6D9840',
}

function themeFrom(page, base, filters) {
  const values = filters.map(item => String(item).split('/'))
  const element = values.find(item => item[0] === '元素')?.[1]
    || String(base.element || '')
  const weapon = values.find(item => item[0] === '武器' || item[0] === '武器类型')?.[1]
    || String(base.weapon_type || base.category || '')
  const rarity = values.find(item => /星/.test(item[0]))?.[1]
  const portraits = []
  for (const module of page?.modules || []) {
    if (module.is_hidden || !/展示/.test(module.name || '')) continue
    for (const component of module.components || []) {
      const data = parseJson(component.data, {})
      for (const item of data.list || []) {
        if (item?.image && /\.(png|jpe?g)(\?|$)/i.test(item.image)) portraits.push(item.image)
      }
    }
  }
  const color = /^#[0-9a-f]{6}$/i.test(base.role_attribute || '') ? base.role_attribute.toUpperCase() : ''
  const elementByColor = Object.entries(ELEMENT_COLORS).find(([, value]) => value.toUpperCase() === color)?.[0] || ''
  return {
    element: element || elementByColor,
    weapon,
    color,
    rarity: base.star ? `${base.star}星` : (rarity && !/星/.test(rarity) ? `${rarity}星` : rarity || ''),
    portrait: '',
  }
}

function isCharacterPage(page) {
  return (page?.modules || []).some(module => (module.components || []).some(component => /role_/.test(component.component_id || '')))
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
    icon: coverIcon(data, page),
    tags: tags.slice(0, 8),
    attrs: attrs.slice(0, 8),
    theme: themeFrom(page, data, filters),
  }
}

const PRIORITY = ['装备描述', '基础信息', '物品描述', '基础属性', '圣遗物件', '成长数值', '角色突破', '推荐装备', '天赋', '命之座', '推荐角色', '特殊料理']
const STORY_TITLE = /故事|神之眼|更多描述|角色详细|角色CV|配音/
const PROFILE_TITLE = /基础资料|基础信息|基础属性|物品描述|装备描述/
const ASCENSION_TITLE = /突破|成长数值|升级材料/

function focusOf(title = '') {
  if (/天赋/.test(title)) return 'talent'
  if (/命之座|命座/.test(title)) return 'constellation'
  if (ASCENSION_TITLE.test(title)) return 'ascension'
  if (STORY_TITLE.test(title)) return 'story'
  if (PROFILE_TITLE.test(title)) return 'profile'
  return ''
}

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
      if (!parsed?.lines?.length && !parsed?.groups?.length && !parsed?.cards?.length) continue
      pending.push({ ...parsed, focus: focusOf(parsed.title) })
    }
  }

  pending.sort((a, b) => {
    const ai = PRIORITY.indexOf(a.title)
    const bi = PRIORITY.indexOf(b.title)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })
  const ordered = [
    ...pending.filter(item => item.focus !== 'story'),
    ...pending.filter(item => item.focus === 'story'),
  ]

  for (const parsed of ordered) {
    const previous = sections.find(section => section.title === parsed.title)
    if (previous) {
      previous.cards = [...(previous.cards || []), ...(parsed.cards || [])]
      previous.groups = [...(previous.groups || []), ...(parsed.groups || [])]
      if (parsed.lines?.length) previous.text = [previous.text, ...parsed.lines].filter(Boolean).join('\n')
      continue
    }
    const key = parsed.title + parsed.lines.join('\n')
    if (seen.has(key)) continue
    seen.add(key)
    pushSection(sections, parsed.title, parsed.lines, parsed.collapse, parsed.groups, parsed.total, parsed.cards)
    const current = sections[sections.length - 1]
    if (current) current.focus = parsed.focus
  }

  const character = isCharacterPage(page)
  const overview = character
    ? sections.filter(section => /推荐装备|特殊料理|圣遗物|基础资料/.test(section.title)).slice(0, 4)
    : sections.filter(section => !STORY_TITLE.test(section.title)).slice(0, 5)

  return {
    id: String(page.id),
    name: page.name || '未命名词条',
    icon: header.icon,
    tags: header.tags,
    attrs: header.attrs,
    theme: header.theme,
    sections: overview,
    parts: character ? {
      talent: sections.filter(section => section.focus === 'talent'),
      constellation: sections.filter(section => section.focus === 'constellation'),
      ascension: sections.filter(section => section.focus === 'ascension'),
      story: sections.filter(section => section.focus === 'story'),
      profile: sections.filter(section => section.focus === 'profile'),
    } : {},
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

