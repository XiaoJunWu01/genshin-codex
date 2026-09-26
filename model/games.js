const LIST_BASE = 'https://act-api-takumi-static.mihoyo.com'
const ENTRY_BASE = 'https://act-api-takumi-static.mihoyo.com'
const SEARCH_BASE = 'https://api-takumi.mihoyo.com'

const GAMES = {
  sr: {
    key: 'sr', name: '星穹铁道', short: '星铁', letter: 's', app: 'sr_wiki',
    referer: 'https://bbs.mihoyo.com/sr/wiki/',
    site: 'https://bbs.mihoyo.com/sr/wiki', detail: 'rpg',
  },
  zzz: {
    key: 'zzz', name: '绝区零', short: '绝区零', letter: 'z', app: 'zzz_wiki', wikiApp: 'zzz',
    referer: 'https://baike.mihoyo.com/zzz/wiki/',
    site: 'https://baike.mihoyo.com/zzz/wiki', detail: 'wiki',
  },
}

const CHANNEL_ALIASES = {
  角色: ['人物'],
  代理人: ['角色', '人物'],
  消耗品: ['食物'],
  阅读物: ['书籍', '书'],
  敌人: ['怪物'],
  材料: ['养成材料', '素材'],
}
const CHANNEL_SKIP = /攻略|成就|模拟宇宙|忘却之庭|虚构叙事|末日幻影|异相仲裁|逐光捡金|连战|活动/
const CACHE_TTL = 30 * 60 * 1000
const LIST_TTL = 6 * 60 * 60 * 1000
const cache = { channels: new Map(), lists: new Map(), searches: new Map(), entries: new Map() }

export async function channelsOf(key) {
  const game = gameOf(key)
  if (!game) return []
  const cached = cache.channels.get(key)
  if (cached && Date.now() - cached.time < LIST_TTL) return cached.items
  const data = await requestJson(game, `${LIST_BASE}/common/blackboard/${game.app}/v1/getChannelTree?app_sn=${game.app}`)
  const root = (data?.children || []).find(node => node?.name === '游戏图鉴') || data
  const items = (root?.children || [])
    .filter(node => node?.channel_id && node?.name && !node.hidden && !(node.children || []).length && !CHANNEL_SKIP.test(node.name))
    .map(node => ({ id: Number(node.channel_id), name: node.name, aliases: [node.name, ...(CHANNEL_ALIASES[node.name] || [])] }))
  if (!items.length) throw new Error('图鉴分类为空')
  cache.channels.set(key, { time: Date.now(), items })
  return items
}

export const GAME_FOCUS = {
  sr: [
    { id: 'trace', name: '行迹', aliases: ['行迹', '技能'] },
    { id: 'eidolon', name: '星魂', aliases: ['星魂'] },
    { id: 'profile', name: '资料', aliases: ['资料', '信息'] },
    { id: 'story', name: '故事', aliases: ['故事', '背景'] },
  ],
  zzz: [
    { id: 'skill', name: '技能', aliases: ['技能'] },
    { id: 'cinema', name: '影画', aliases: ['影画'] },
    { id: 'profile', name: '资料', aliases: ['资料', '信息'] },
    { id: 'story', name: '故事', aliases: ['故事', '背景'] },
  ],
}

const fetchCompat = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args)
  return import('node-fetch').then(mod => mod.default(...args))
}

export function gameOf(key) { return GAMES[key] || null }

export function focusOf(key, keyword) {
  const text = String(keyword || '').trim()
  return (GAME_FOCUS[key] || []).find(item => item.id === text || item.aliases.includes(text)) || null
}

export async function channelOf(key, keyword) {
  const text = String(keyword || '').trim()
  return (await channelsOf(key)).find(item => item.name === text || item.aliases.includes(text)) || null
}

export function focusPattern(key) {
  return (GAME_FOCUS[key] || []).flatMap(item => item.aliases).sort((a, b) => b.length - a.length).join('|')
}

export async function channelPattern(key) {
  return (await channelsOf(key)).flatMap(item => item.aliases).sort((a, b) => b.length - a.length).join('|')
}

function headersOf(game) {
  return {
    accept: 'application/json, text/plain, */*',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    referer: game.referer,
    'x-rpc-language': 'zh-cn',
    ...(game.wikiApp ? { 'x-rpc-wiki_app': game.wikiApp } : {}),
  }
}

async function requestJson(game, url) {
  const res = await fetchCompat(url, { headers: headersOf(game) })
  if (!res.ok) throw new Error(`${game.name}图鉴请求失败: ${res.status}`)
  const json = await res.json()
  if (json?.retcode !== 0) throw new Error(json?.message || `${game.name}图鉴返回异常`)
  return json.data
}

export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n· ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function parseJson(value, fallback) {
  if (!value) return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return fallback }
}

function normalizeName(value) {
  return stripHtml(value).replace(/[【】\[\]()（）·\s]/g, '').toLowerCase()
}

function parseItemFilters(value) {
  const ext = parseJson(value, {})
  const bag = Object.values(ext || {}).map(item => item?.filter?.text).find(Boolean)
  const filters = {}
  for (const tag of parseJson(bag, [])) {
    const slash = String(tag).indexOf('/')
    if (slash <= 0) continue
    const key = String(tag).slice(0, slash).trim()
    const option = String(tag).slice(slash + 1).trim()
    if (!key || !option) continue
    if (!filters[key]) filters[key] = []
    if (!filters[key].includes(option)) filters[key].push(option)
  }
  return filters
}

async function listItems(game, channel) {
  const cacheKey = `${game.key}:${channel.id}`
  const cached = cache.lists.get(cacheKey)
  if (cached && Date.now() - cached.time < LIST_TTL) return cached.items
  const data = await requestJson(game, `${LIST_BASE}/common/blackboard/${game.app}/v1/home/content/list?app_sn=${game.app}&channel_id=${channel.id}`)
  const items = []
  for (const group of data?.list || []) {
    for (const item of group.list || []) {
      if (!item?.content_id || !item?.title) continue
      items.push({
        id: String(item.content_id), name: item.title, icon: item.icon || '',
        alias: stripHtml(item.alias_name || ''), summary: stripHtml(item.summary || ''),
        channelId: channel.id, channelName: channel.name,
        filters: parseItemFilters(item.ext), game: game.key,
      })
    }
  }
  cache.lists.set(cacheKey, { time: Date.now(), items })
  return items
}

function scoreItem(item, keyword) {
  const query = normalizeName(keyword)
  const rank = value => {
    const text = normalizeName(value)
    if (!text) return 0
    if (text === query) return 100
    if (text.startsWith(query)) return 80
    if (text.includes(query)) return 60
    return 0
  }
  return Math.max(rank(item.name), rank(item.alias))
}

async function searchRemote(game, keyword) {
  const cacheKey = `${game.key}:${normalizeName(keyword)}`
  const cached = cache.searches.get(cacheKey)
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.items
  const data = await requestJson(game, `${SEARCH_BASE}/common/blackboard/${game.app}/v1/search/content?keyword=${encodeURIComponent(keyword)}&app_sn=${game.app}&page_size=8`)
  const items = (data?.list || []).map(item => ({
    id: String(item.id), name: stripHtml(item.title), icon: item.icon || '',
    summary: stripHtml(item.summary || ''),
    channelId: Number(item.channels?.[0]?.channel_id || 0),
    channelName: item.channels?.[0]?.name || '', game: game.key,
  })).filter(item => item.id && item.name)
  cache.searches.set(cacheKey, { time: Date.now(), items })
  return items
}

export async function searchGame(key, keyword, { channelId = 0, limit = 8 } = {}) {
  const game = gameOf(key)
  const text = String(keyword || '').trim()
  if (!game || !text) return []
  const collected = new Map()
  const add = item => {
    const score = scoreItem(item, text)
    if (score < 95) return
    const prev = collected.get(item.id)
    if (!prev || score > prev.score) collected.set(item.id, { ...item, score })
  }
  if (channelId) {
    const channel = (await channelsOf(key)).find(item => item.id === channelId)
    if (channel) for (const item of await listItems(game, channel)) add(item)
  } else {
    try { for (const item of await searchRemote(game, text)) add(item) }
    catch (err) { logger.warn(`[${game.name}图鉴] 搜索失败，改用目录:`, err.message || err) }
    if (!collected.size) {
      const lists = await Promise.all((await channelsOf(key)).map(item => listItems(game, item).catch(() => [])))
      for (const items of lists) items.forEach(add)
    }
  }
  return [...collected.values()].sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, limit)
}

export async function listGame(key, channel, page = 1) {
  const items = await listItems(gameOf(key), channel)
  const size = 24
  const totalPage = Math.max(1, Math.ceil(items.length / size))
  const current = Math.max(1, page)
  const start = (current - 1) * size
  return { channel, page: current, totalPage, total: items.length, items: items.slice(start, start + size) }
}

function textOf(value) {
  return stripHtml(value).replace(/\s+/g, ' ').trim()
}

function section(title, lines = [], cards = [], focus = '') {
  const text = lines.map(textOf).filter(Boolean)
  const list = cards.filter(card => card?.name || card?.text)
  if (!text.length && !list.length) return null
  return { title, text: text.join('\n'), lines: text, cards: list, groups: [], images: [], videos: [], focus }
}

function cardsFromHtml(html) {
  const rows = [...String(html || '').matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(row => row[0])
  const cards = []
  const iconsIn = value => [...String(value).replace(/\\"/g, '"').matchAll(/data-(?:image-url|entry-icon)="([^"]+)"/g)].map(item => item[1])
  for (let index = 0; index < rows.length; index += 1) {
    const cells = [...rows[index].matchAll(/<td[\s\S]*?<\/td>/gi)].map(cell => cell[0])
    if (cells.length < 2) continue
    const span = Number(cells[0].match(/rowspan="(\d+)"/)?.[1] || 1)
    const covered = rows.slice(index, index + span).join('')
    const icons = iconsIn(covered)
    const heading = cells.find(cell => /<h[1-6]/i.test(cell))
    const name = textOf(heading?.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || '')
      || [...covered.replace(/\\"/g, '"').matchAll(/data-entry-title="([^"]+)"/g)].map(item => item[1]).find(Boolean)
      || ''
    const text = stripHtml(covered).replace(name, '').trim()
    if (name && (text || icons.length)) cards.push({ name, text, icons })
    if (span > 1) index += span - 1
  }
  return cards
}

function remember(sections, parts, block) {
  if (!block) return
  sections.push(block)
  if (!block.focus) return
  if (!parts[block.focus]) parts[block.focus] = []
  parts[block.focus].push(block)
}

function formatRpg(game, content) {
  const body = content?.rpg_new_tmp_content
  if (!body) return null
  const info = body.base?.userInfo || {}
  const sections = []
  const parts = {}
  for (const module of body.modules || []) {
    for (const component of module.components || []) {
      const data = parseJson(component.data, {})
      if (component.componentId === 'character_info') {
        const lines = (data.list || []).map(item => [item.rightKey, item.rightValue].filter(Boolean).join('：'))
        remember(sections, parts, section(module.name, lines, [], 'profile'))
      } else if (component.componentId === 'trace_graph') {
        const cards = (data.points || []).flatMap(point => (point.subList || []).map(item => ({
          name: textOf(item.subTitle || item.title), text: stripHtml(item.subDesc || item.desc), icon: item.image || '',
        }))).filter(item => item.name && item.text)
        remember(sections, parts, section(module.name, [], cards.slice(0, 8), 'trace'))
      } else if (component.componentId === 'character_rich') {
        const focus = /星魂/.test(module.name) ? 'eidolon' : /故事|语音|关系/.test(module.name) ? 'story' : ''
        const cards = cardsFromHtml(data.richText)
        remember(sections, parts, cards.length ? section(module.name, [], cards.slice(0, 8), focus) : section(module.name, [data.richText], [], focus))
      }
    }
  }
  const filters = parseItemFilters(content.ext)
  const attrs = (parts.profile?.[0]?.lines || []).map(line => {
    const [key, ...rest] = line.split('：')
    return { key, value: rest.join('：') }
  })
  return {
    id: String(content.id), name: content.title || info.name || '未命名词条',
    icon: content.icon || info.icon || '', tags: Object.values(filters).flat(), attrs,
    theme: { element: filters['属性']?.[0] || '', weapon: filters['命途']?.[0] || '', rarity: filters['星级']?.[0] || '' },
    sections: sections.filter(item => !/画廊|语音/.test(item.title)).slice(0, 5),
    portraits: [], motions: [], videos: [], parts, url: `${game.site}/content/${content.id}/detail`,
  }
}

function formatWiki(game, page) {
  const sections = []
  const parts = {}
  for (const module of page?.modules || []) {
    for (const component of module.components || []) {
      const data = parseJson(component.data, {})
      const id = component.component_id || ''
      if (id === 'role_talent') {
        const cards = (data.list || []).flatMap(item => item.children || []).map(item => ({
          name: textOf(item.title), text: stripHtml(item.desc), icon: item.animated_icon || item.icon || '',
        })).filter(item => item.name && item.text)
        remember(sections, parts, section(module.name || '技能', [], cards.slice(0, 8), 'skill'))
      } else if (id === 'double_col_table') {
        const cards = (data.tables || []).flatMap(table => (table.row || []).map(row => {
          const source = Array.isArray(row) ? row : Object.values(row || {})
          const icon = source.map(cell => String(cell).replace(/\\"/g, '"').match(/data-(?:image-url|entry-icon)="([^"]+)"/)?.[1] || '').find(Boolean) || ''
          const textCells = source.map(cell => stripHtml(cell)).filter(Boolean)
          return { name: textCells[0] || '', text: textCells.slice(1).join('\n'), icon }
        }))
        remember(sections, parts, section(module.name || '影画', [], cards.filter(item => item.name && item.text).slice(0, 6), 'cinema'))
      } else if (/base_info/.test(id)) {
        const lines = Object.entries(data.attr || {}).slice(0, 8).map(([key, value]) => `${key}：${textOf(value?.value || value)}`)
        remember(sections, parts, section(module.name || '基础资料', lines, [], 'profile'))
      } else if (id === 'collapse_panel' || id === 'good_desc') {
        remember(sections, parts, section(module.name || '详情', [data.rich_text || ''], [], /故事|印象|CV/.test(module.name || '') ? 'story' : ''))
      }
    }
  }
  const attrs = (parts.profile?.[0]?.lines || []).map(line => {
    const [key, ...rest] = line.split('：')
    return { key, value: rest.join('：') }
  })
  const rawTags = page?.filter_values
  const tagList = Array.isArray(rawTags) ? rawTags : Object.values(rawTags || {})
  const tags = tagList.map(tag => String(tag?.value || tag).split('/').pop()).filter(Boolean)
  return {
    id: String(page.id), name: page.name || '未命名词条', icon: page.icon_url || '', tags, attrs,
    theme: { element: tags[1] || '', weapon: tags[2] || '', rarity: tags[0] || '' },
    sections: sections.slice(0, 5), portraits: [], motions: [], videos: [], parts,
    url: `${game.site}/content/${page.id}/detail`,
  }
}

export async function getGameEntry(key, id) {
  const game = gameOf(key)
  const cacheKey = `${key}:${id}`
  const cached = cache.entries.get(cacheKey)
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.entry
  const entry = game.detail === 'rpg'
    ? formatRpg(game, (await requestJson(game, `${LIST_BASE}/common/blackboard/${game.app}/v1/content/info?app_sn=${game.app}&content_id=${encodeURIComponent(id)}`))?.content)
    : formatWiki(game, (await requestJson(game, `${ENTRY_BASE}/hoyowiki/wapi/entry_page?entry_page_id=${encodeURIComponent(id)}&lang=zh-cn`))?.page)
  if (!entry) throw new Error('词条内容为空')
  cache.entries.set(cacheKey, { time: Date.now(), entry })
  return entry
}

