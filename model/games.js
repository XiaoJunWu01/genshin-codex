import { aliasNames } from './alias.js'
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
  ys: {
    key: 'ys', name: '原神', short: '原神', letter: 'g', app: 'ys_obc',
    referer: 'https://baike.mihoyo.com/',
    site: 'https://baike.mihoyo.com/ys/wiki', detail: 'genshin',
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
const MOTION = /\.(?:gif|webp)(?:$|\?)/i
const CACHE_TTL = 30 * 60 * 1000
const LIST_TTL = 6 * 60 * 60 * 1000
const cache = { channels: new Map(), lists: new Map(), searches: new Map(), entries: new Map() }
const formatters = {}

export function registerGame(key, format) {
  formatters[key] = format
}

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

const fetchCompat = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args)
  return import('node-fetch').then(mod => mod.default(...args))
}

export function gameOf(key) { return GAMES[key] || null }

export async function channelOf(key, keyword) {
  const text = String(keyword || '').trim()
  return (await channelsOf(key)).find(item => item.name === text || item.aliases.includes(text)) || null
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
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n· ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\\n/g, '\n').replace(/\\t/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function parseJson(value, fallback) {
  if (!value) return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return fallback }
}

function normalizeName(value) {
  return stripHtml(value).replace(/[【】\[\]()（）·\s]/g, '').toLowerCase()
}

export function shortName(value) {
  return stripHtml(value).replace(/[（(][^）)]*[）)]/g, '').split(/[·•・:：丨|]/)[0].trim()
}

export function parseItemFilters(value) {
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
        id: String(item.content_id), name: shortName(item.title), fullName: item.title, icon: item.icon || '',
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
    const head = normalizeName(shortName(value))
    if (!text) return 0
    if (text === query || head === query) return 100
    if (text.startsWith(query)) return 80
    if (text.includes(query)) return 60
    return 0
  }
  const mapped = aliasNames(item.game, keyword).some(name => {
    const target = normalizeName(name)
    return [item.name, item.fullName].some(value => {
      const text = normalizeName(value)
      return text === target || (text.startsWith(target) && text.length <= target.length + 4) || (target.startsWith(text) && target.length <= text.length + 4)
    })
  })
  return Math.max(rank(item.name), rank(item.fullName), rank(item.alias), mapped ? 100 : 0)
}

const MEDIA_ENTRY = /视频|攻略|一图流|配队|养成|玩法|解析|上手|评测|壁纸|表情/
const ENTRY_CHANNEL = /^(?:角色|代理人|光锥|音擎|驱动盘|遗器|敌人|材料|消耗品|阅读物)$/

function rankChannel(item) {
  const name = item.channelName || ''
  if (ENTRY_CHANNEL.test(name)) return 0
  if (/视频|攻略|地图|玩法|壁纸|表情/.test(name)) return 2
  return 1
}

async function searchRemote(game, keyword) {
  const cacheKey = `${game.key}:${normalizeName(keyword)}`
  const cached = cache.searches.get(cacheKey)
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.items
  const data = await requestJson(game, `${SEARCH_BASE}/common/blackboard/${game.app}/v1/search/content?keyword=${encodeURIComponent(keyword)}&app_sn=${game.app}&page_size=8`)
  const items = (data?.list || []).map(item => ({
    id: String(item.id), name: shortName(item.title), fullName: stripHtml(item.title), icon: item.icon || '',
    summary: stripHtml(item.summary || ''),
    channelId: Number(item.channels?.[0]?.channel_id || 0),
    channelName: item.channels?.[0]?.name || '', game: game.key,
  })).filter(item => item.id && item.name && item.channelId && !MEDIA_ENTRY.test(`${item.fullName}${item.channelName}`))
  cache.searches.set(cacheKey, { time: Date.now(), items })
  return items
}

export async function searchGame(key, keyword, { channelId = 0, limit = 8 } = {}) {
  const game = gameOf(key)
  const text = String(keyword || '').trim()
  const names = aliasNames(key, text)
  const searchText = names.length === 1 ? names[0] : text
  if (!game || !text) return []
  const collected = new Map()
  const add = item => {
    const score = scoreItem(item, text)
    if (score < 95 || MEDIA_ENTRY.test(`${item.fullName || ''}${item.channelName || ''}`)) return
    const prev = collected.get(item.name)
    if (!prev || score > prev.score || (score === prev.score && rankChannel(item) < rankChannel(prev))) collected.set(item.name, { ...item, score })
  }
  if (channelId) {
    const channel = (await channelsOf(key)).find(item => item.id === channelId)
    if (channel) for (const item of await listItems(game, channel)) add(item)
  } else {
    try { for (const item of await searchRemote(game, searchText)) add(item) }
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

export function textOf(value) {
  return stripHtml(value).replace(/\s+/g, ' ').trim()
}

export function section(title, lines = [], cards = [], focus = '', groups = [], images = [], videos = [], empty = '') {
  const text = lines.map(textOf).filter(line => line && line !== '暂无')
  const list = cards.filter(card => card?.name || card?.text || card?.icon)
  const levels = groups.filter(group => group?.materials?.length || group?.note)
  const shots = images.filter(item => item?.src)
  const clips = videos.filter(item => item?.page || item?.src)
  if (!text.length && !list.length && !levels.length && !shots.length && !clips.length && !empty) return null
  return { title, text: text.join('\n'), lines: text, cards: list, groups: levels, images: shots, videos: clips, focus, empty }
}

export function peopleFromHtml(html) {
  const source = String(html || '').replace(/\\"/g, '"')
  const people = []
  const seen = new Set()
  for (const match of source.matchAll(/data-entry-name="([^"]+)"/g)) {
    const name = textOf(match[1])
    if (!name || seen.has(name)) continue
    seen.add(name)
    const start = source.lastIndexOf('<', match.index)
    const next = source.indexOf('data-entry-name=', match.index + 1)
    const block = source.slice(start < 0 ? match.index : start, next < 0 ? source.length : next)
    people.push({
      name,
      icon: block.match(/data-entry-(?:img|icon)="([^"]+)"/)?.[1] || '',
    })
  }
  return people
}

export function cardsFromHtml(html) {
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

export function remember(sections, parts, block) {
  if (!block) return
  sections.push(block)
  if (!block.focus) return
  if (!parts[block.focus]) parts[block.focus] = []
  parts[block.focus].push(block)
}

export function stillOf(src) {
  return src && !MOTION.test(src) ? src : ''
}

export function motionOf(src) {
  return src && MOTION.test(src) ? src : ''
}

export function named(title, fallback) {
  return title && !/默认标题|暂无/.test(title) ? title : fallback
}

export function entriesFromHtml(html) {
  const source = String(html || '').replace(/\\"/g, '"')
  return [...source.matchAll(/data-entry-(?:name|amount|desc|img)="([^"]*)"/g)]
    .reduce((items, match, index, all) => {
      if (!match[0].startsWith('data-entry-name=')) return items
      const nearby = all.slice(Math.max(0, index - 6), index + 7).map(item => item[0])
      const amount = nearby.find(item => item.startsWith('data-entry-amount=')) || nearby.find(item => item.startsWith('data-entry-desc='))
      const icon = nearby.find(item => item.startsWith('data-entry-img='))
      items.push({
        name: textOf(match[1]),
        amount: amount ? amount.replace(/^data-entry-(?:amount|desc)="/, '').replace(/"$/, '') : '',
        icon: icon ? icon.replace(/^data-entry-img="/, '').replace(/"$/, '').split('?')[0] : '',
      })
      return items
    }, [])
    .filter(item => item.name && !/暂无/.test(item.name))
}

export function tableCards(data) {
  return (data.tables || []).flatMap(table => {
    const group = named(textOf(table.tab_name), '')
    return (table.row || []).map(row => {
      const source = Array.isArray(row) ? row : Object.values(row || {})
      const icon = source.map(cell => String(cell).replace(/\\"/g, '"').match(/data-(?:image-url|entry-icon)="([^"]+)"/)?.[1] || '').find(Boolean) || ''
      const textCells = source.map(cell => stripHtml(cell).replace(/默认标题/g, '').trim()).filter(Boolean)
      if (!textCells.length) return null
      if (textCells.length < 2) return { name: textCells[0], text: '', icon, group: '' }
      return { name: textCells[0], text: textCells.slice(1).join('\n'), icon, group }
    })
  }).filter(item => item && item.name && (item.text || item.icon))
}

const MEDIA = {
  sr: {
    id: '2391', kind: 'emoji', name: '表情包',
    videos: [
      { id: 27, name: '角色视频' },
      { id: 196, name: '其他视频' },
    ],
  },
  zzz: {
    id: '688', kind: 'wallpaper', name: '壁纸',
    videos: [
      { id: 73, name: '角色视频' },
      { id: 72, name: '其他视频' },
    ],
  },
  ys: {
    kind: 'video', name: '影音',
    groups: [
      { id: 212, name: '角色视频' },
      { id: 81, name: '过场动画' },
      { id: 238, name: '其他视频' },
    ],
  },
}
const GAME_IDS = { sr: '6', zzz: '8', ys: '2' }

export function mediaOf(key) {
  return MEDIA[key] || null
}

export async function mediaGroups(key) {
  const spec = MEDIA[key]
  const game = gameOf(key)
  if (!spec || !game) return []
  const cached = cache.lists.get(`${key}:media`)
  if (cached && Date.now() - cached.time < LIST_TTL) return cached.items
  let items = []
  if (spec.kind === 'video') {
    const lists = await Promise.all(spec.groups.map(group => listMedia(game, group)))
    items = lists.flat()
  } else if (spec.videos) {
    const lists = await Promise.all(spec.videos.map(group => listMedia(game, group)))
    items = lists.flat()
  } else {
    const page = await mediaPage(key, spec.id)
    items = imageGroups(page).map(group => ({ id: group.name, name: group.name, count: group.images.length }))
  }
  cache.lists.set(`${key}:media`, { time: Date.now(), items })
  return items
}

export async function mediaImages(key, name) {
  const spec = MEDIA[key]
  const groups = imageGroups(await mediaPage(key, spec.id))
  const found = groups.find(group => group.name === name) || groups.find(group => group.name.includes(name))
  return found?.images || []
}

export async function mediaVideos(key, keyword = '') {
  const spec = MEDIA[key]
  const items = await mediaGroups(key)
  const text = String(keyword || '').trim()
  const groups = spec.groups || spec.videos || []
  const group = groups.find(item => item.name === text)
  const matched = items.filter(item => group ? item.group === group.name : item.name.includes(text) || item.group.includes(text))
  return { total: matched.length, items: matched }
}

export async function mediaClip(key, id) {
  const item = (await mediaGroups(key)).find(entry => entry.id === String(id))
  if (!item) return null
  const post = String(item.bbs || '').match(/article\/(\d+)/)?.[1] || ''
  if (post) {
    const src = await resolveVideo(key, post)
    return src ? { ...item, src } : null
  }
  const page = await mediaPage(key, item.id)
  const html = JSON.stringify(page || {})
  const src = [...html.matchAll(/https?:\\?\/\\?\/[^"'\\\s]+?\.mp4/gi)].map(match => match[0].replace(/\\\//g, '/'))[0] || ''
  return src ? { ...item, src } : null
}

async function listMedia(game, group) {
  const items = []
  for (let page = 1; page <= 30; page += 1) {
    let data = null
    try {
      data = await requestJson(game, `${LIST_BASE}/common/blackboard/${game.app}/v1/home/content/list?app_sn=${game.app}&channel_id=${group.id}&page=${page}&page_size=50`)
    } catch { break }
    const rows = (data?.list || []).flatMap(row => row.list || [])
    const fresh = rows.filter(item => !items.some(saved => saved.id === String(item.content_id)))
    if (!fresh.length) break
    items.push(...fresh.map(item => ({
      id: String(item.content_id), name: item.title, group: group.name,
      cover: item.icon || '', summary: item.summary || '', bbs: item.bbs_url || '',
    })))
    if (fresh.length < rows.length || rows.length < 50) break
  }
  return items
}

async function mediaPage(key, id) {
  const game = gameOf(key)
  if (key === 'ys') return (await requestJson(game, `https://api-takumi-static.mihoyo.com/hoyowiki/genshin/wapi/entry_page?app_sn=${game.app}&entry_page_id=${encodeURIComponent(id)}&lang=zh-cn`))?.page
  if (key === 'zzz') return (await requestJson(game, `${ENTRY_BASE}/hoyowiki/wapi/entry_page?entry_page_id=${encodeURIComponent(id)}&lang=zh-cn`))?.page
  return (await requestJson(game, `${LIST_BASE}/common/blackboard/${game.app}/v1/content/info?app_sn=${game.app}&content_id=${encodeURIComponent(id)}`))?.content
}

function imageGroups(page) {
  const html = page?.contents ? (page.contents || []).map(tab => tab.text || '').join('\n') : ''
  if (html) {
    const images = [...html.matchAll(/<img[^>]+src="([^"]+\.(?:png|jpg|jpeg|gif|webp))"/gi)]
      .map(item => item[1]).filter(src => !/icon|avatar/i.test(src))
    const size = 24
    return Array.from({ length: Math.ceil(images.length / size) }, (_, index) => ({
      name: `第${index + 1}组`,
      images: images.slice(index * size, index * size + size),
    }))
  }
  const groups = new Map()
  for (const module of page?.modules || []) {
    for (const component of module.components || []) {
      for (const item of parseJson(component.data, {}).list || []) {
        const name = textOf(item.tab_name)
        if (!name || name === '默认标题' || !item.image || MOTION.test(item.image)) continue
        if (!groups.has(name)) groups.set(name, [])
        groups.get(name).push(item.image)
      }
    }
  }
  return [...groups.entries()].map(([name, images]) => ({ name, images }))
}

export async function resolveVideo(key, page) {
  const gid = GAME_IDS[key] || '2'
  const data = await requestJson(gameOf(key), `https://bbs-api.miyoushe.com/post/wapi/getPostFull?post_id=${encodeURIComponent(page)}&gids=${gid}`)
  const vod = data?.post?.vod_list?.[0]
  const clips = vod?.resolutions || []
  const clip = clips.find(item => item.definition === '720P') || clips[clips.length - 1]
  return clip?.url || ''
}

export async function getGameEntry(key, id, hint = null) {
  const game = gameOf(key)
  const cacheKey = `${key}:${id}`
  const cached = cache.entries.get(cacheKey)
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.entry
  const format = formatters[key]
  if (!format) throw new Error(`${game?.name || key}词条解析未加载`)
  const raw = game.detail === 'rpg'
    ? (await requestJson(game, `${LIST_BASE}/common/blackboard/${game.app}/v1/content/info?app_sn=${game.app}&content_id=${encodeURIComponent(id)}`))?.content
    : (await requestJson(game, `${ENTRY_BASE}/hoyowiki/wapi/entry_page?entry_page_id=${encodeURIComponent(id)}&lang=zh-cn`))?.page
  const entry = format(game, raw, hint)
  if (!entry) throw new Error('词条内容为空')
  cache.entries.set(cacheKey, { time: Date.now(), entry })
  return entry
}
