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
const ZZZ_CODES = {
  ether: '以太', fire: '火', ice: '冰', electric: '电', physic: '物理', physics: '物理',
  wind: '风', frost: '烈霜', lumino: '流明', blade: '凛刃', ink: '玄墨',
  support: '支援', attack: '强攻', stun: '击破', anomaly: '异常', defense: '防护',
  rupture: '命破', guard: '锋御',
}
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
    { id: 'ascension', name: '晋阶', aliases: ['晋阶', '突破', '养成', '材料'] },
    { id: 'effect', name: '效果', aliases: ['效果'] },
    { id: 'profile', name: '资料', aliases: ['资料', '信息'] },
    { id: 'story', name: '故事', aliases: ['故事', '背景'] },
    { id: 'portrait', name: '立绘', aliases: ['立绘', '原画', '全身'] },
    { id: 'video', name: '视频', aliases: ['视频', 'pv', 'PV', '动画'] },
    { id: 'detail', name: '全文', aliases: ['全文', '详细', '详情'] },
  ],
  zzz: [
    { id: 'skill', name: '技能', aliases: ['技能'] },
    { id: 'cinema', name: '影画', aliases: ['影画'] },
    { id: 'ascension', name: '突破', aliases: ['突破', '养成', '材料'] },
    { id: 'profile', name: '资料', aliases: ['资料', '信息'] },
    { id: 'story', name: '故事', aliases: ['故事', '背景'] },
    { id: 'portrait', name: '立绘', aliases: ['立绘', '原画', '全身'] },
    { id: 'video', name: '视频', aliases: ['视频', 'pv', 'PV', '动画'] },
    { id: 'detail', name: '全文', aliases: ['全文', '详细', '详情'] },
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

function shortName(value) {
  return stripHtml(value).replace(/[（(][^）)]*[）)]/g, '').split(/[·:：]/)[0].trim()
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
  })).filter(item => item.id && item.name && item.channelId && !/攻略|一图流|配队|养成/.test(item.fullName))
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
    if (score < 95) return
    const prev = collected.get(item.id)
    if (!prev || score > prev.score) collected.set(item.id, { ...item, score })
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

function textOf(value) {
  return stripHtml(value).replace(/\s+/g, ' ').trim()
}

function section(title, lines = [], cards = [], focus = '', groups = [], images = [], videos = []) {
  const text = lines.map(textOf).filter(Boolean)
  const list = cards.filter(card => card?.name || card?.text)
  const levels = groups.filter(group => group?.materials?.length || group?.note)
  const shots = images.filter(item => item?.src)
  const clips = videos.filter(item => item?.page || item?.src)
  if (!text.length && !list.length && !levels.length && !shots.length && !clips.length) return null
  return { title, text: text.join('\n'), lines: text, cards: list, groups: levels, images: shots, videos: clips, focus }
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
  if (content?.rpg_new_tmp_content) return formatCharacter(game, content)
  if (content?.contents?.length) return formatTabs(game, content)
  return null
}

function formatCharacter(game, content) {
  const body = content.rpg_new_tmp_content
  const info = body.base?.userInfo || {}
  const sections = []
  const parts = {}
  const motions = []
  const portraits = []
  const videos = []
  if (info.figurePath) portraits.push({ name: '角色立绘', src: info.figurePath })
  for (const module of body.modules || []) {
    for (const component of module.components || []) {
      const data = parseJson(component.data, {})
      if (component.componentId === 'character_info') {
        const lines = (data.list || []).map(item => [item.rightKey, item.rightValue].filter(Boolean).join('：'))
        remember(sections, parts, section(module.name, lines, [], 'profile'))
      } else if (component.componentId === 'role_ascension') {
        remember(sections, parts, section(module.name || '角色晋阶', [], [], 'ascension', ascensionGroups(data.list)))
      } else if (component.componentId === 'trace_graph') {
        const cards = (data.points || []).flatMap(point => {
          const group = textOf(point.tag || point.name)
          return (point.subList || []).map(item => ({
            name: textOf(item.subTitle) || textOf(point.name).split('/')[0],
            text: stripHtml(item.subDesc || item.desc),
            icon: stillOf(item.image),
            group,
          }))
        }).filter(item => item.name && item.text)
        const skills = cards.filter(card => /普攻|战技|终结技|天赋|秘技|额外能力/.test(card.group))
        const rest = cards.filter(card => !skills.includes(card))
        remember(sections, parts, section(module.name || '角色行迹', [], [...skills, ...rest], 'trace'))
      } else if (component.componentId === 'character_rich') {
        const focus = /星魂/.test(module.name) ? 'eidolon' : /故事|语音|关系/.test(module.name) ? 'story' : ''
        const cards = cardsFromHtml(data.richText)
        const limit = focus === 'eidolon' ? cards.length : /推荐/.test(module.name) ? 4 : 8
        remember(sections, parts, cards.length ? section(module.name, [], cards.slice(0, limit), focus) : section(module.name, [data.richText], [], focus))
      } else if (component.componentId === 'character_story') {
        const lines = (data.list || []).map(item => [textOf(item.tabName), textOf(item.desc)].filter(Boolean).join('\n'))
        remember(sections, parts, section(module.name || '角色故事', lines, [], 'story'))
      } else if (component.componentId === 'character_gallery') {
        collectGallery(data, portraits, videos)
      }
    }
  }
  const filters = parseItemFilters(content.ext)
  const attrs = (parts.profile?.[0]?.lines || []).map(line => {
    const [key, ...rest] = line.split('：')
    return { key, value: rest.join('：') }
  })
  const overview = sections.filter(item => !item.focus || /profile|ascension|set/.test(item.focus))
  return {
    id: String(content.id), name: shortName(content.title || info.name) || '未命名词条',
    icon: content.icon || info.icon || '', tags: Object.values(filters).flat(), attrs,
    theme: { element: filters['属性']?.[0] || '', path: filters['命途']?.[0] || '', rarity: filters['星级']?.[0] || '', portrait: portraits[0]?.src || '' },
    sections: overview.slice(0, 3),
    all: sections.filter(item => item.focus !== 'story' && item.focus !== 'portrait'),
    motions, portraits, videos, parts, url: `${game.site}/content/${content.id}/detail`,
  }
}

function formatTabs(game, content) {
  const sections = []
  const parts = {}
  const motions = []
  const portraits = []
  const facts = []
  for (const tab of content.contents || []) {
    for (const block of blocksOf(tab.text)) {
      const data = block.data || {}
      const key = block.tmplKey || ''
      if (key === 'light') {
        facts.push(['命途', textOf(data.career)], ['稀有度', textOf(data.rate)])
        if (data.image) portraits.push({ name: '光锥', src: data.image })
        remember(sections, parts, section('光锥效果', [data.skill], [], 'effect'))
        remember(sections, parts, section('光锥故事', [data.desc], [], 'story'))
        remember(sections, parts, section('光锥晋阶', [], [], 'ascension', coneGroups(data.attr)))
      } else if (key === 'heritage') {
        const name = textOf((data.content || []).find(item => item.name === '套装名称')?.value)
        if (name) remember(sections, parts, section('套装效果', [data.story], [], 'set'))
        else remember(sections, parts, section(textOf((data.content || [])[0]?.value) || '遗器', [data.desc, data.story], [], 'story'))
      } else if (key === 'enemy') {
        if (data.introduce) {
          facts.push(['种类', textOf(data.kind)], ['弱点', textOf(data.weak)], ['抗性', textOf(data.resistance)])
          remember(sections, parts, section('敌人资料', [data.introduce], [], 'profile'))
        }
        const cards = (data.attr || []).map(item => ({ name: textOf(item.title || item.name_), text: textOf(item.introduction) }))
        for (const item of data.attr || []) if (motionOf(item.gif)) motions.push({ name: textOf(item.title || item.name_) || '招式', src: item.gif })
        remember(sections, parts, section(textOf(data.name) || '招式', [], cards, 'skill'))
      } else if (key === 'material') {
        facts.push(['稀有度', textOf(data.rate)], ['类型', textOf(data.type)])
        remember(sections, parts, section('材料', [data.desc], [], 'profile'))
      }
    }
  }
  const attrs = facts.filter(([, value]) => value).map(([key, value]) => ({ key, value }))
  const pick = name => attrs.find(item => item.key === name)?.value || ''
  return {
    id: String(content.id), name: shortName(content.title) || '未命名词条', icon: content.icon || '',
    tags: attrs.map(item => item.value), attrs,
    theme: { element: pick('弱点'), path: pick('命途'), rarity: pick('稀有度'), portrait: portraits[0]?.src || '' },
    sections: sections.filter(item => !item.focus || /profile|ascension|set/.test(item.focus)).slice(0, 3),
    all: sections.filter(item => item.focus !== 'story' && item.focus !== 'portrait'), motions, portraits, videos: [], parts,
    url: `${game.site}/content/${content.id}/detail`,
  }
}

function blocksOf(html) {
  const blocks = []
  for (const item of [...String(html || '').matchAll(/data-data="([^"]+)"/g)]) {
    let value = item[1]
    try { value = decodeURIComponent(value) } catch {}
    const data = parseJson(value, null)
    for (const block of Array.isArray(data) ? data : [data]) if (block?.tmplKey) blocks.push(block)
  }
  return blocks
}

function stillOf(src) {
  return src && !MOTION.test(src) ? src : ''
}

function motionOf(src) {
  return src && MOTION.test(src) ? src : ''
}

function formatWiki(game, page) {
  const sections = []
  const parts = {}
  const profile = []
  const motions = []
  const portraits = []
  const videos = []
  for (const module of page?.modules || []) {
    for (const component of module.components || []) {
      const data = parseJson(component.data, {})
      const id = component.component_id || ''
      const title = module.name || ''
      if (id === 'role_base_info') {
        const facts = [['属性', data.role_attribute], ['特性', data.role_profession], ['稀有度', data.grade]]
          .map(([key, value]) => [key, wikiValue(value)]).filter(([, value]) => value)
          .map(([key, value]) => `${key}：${value}`)
        profile.push(...facts, ...baseLines(data.attr))
        if (data.tachie_pc || data.tachie_m) portraits.push({ name: '角色立绘', src: data.tachie_pc || data.tachie_m })
        remember(sections, parts, section(title || '基础资料', facts, [], 'profile'))
      } else if (id === 'material_base_info') {
        const facts = [['稀有度', data.grade], ['类型', data.type]]
          .map(([key, value]) => [key, wikiValue(value)]).filter(([, value]) => value)
          .map(([key, value]) => `${key}：${value}`)
        profile.push(...facts)
        remember(sections, parts, section(title || '基础资料', facts, [], 'profile'))
      } else if (id === 'rich_row_base_info') {
        const lines = baseLines(data.attr)
        profile.push(...lines)
        remember(sections, parts, section(title || '基础资料', lines, [], 'profile'))
      } else if (id === 'role_talent') {
        const cards = (data.list || []).flatMap(item => item.children || []).map(item => ({
          name: textOf(item.title), text: stripHtml(item.desc), icon: stillOf(item.icon),
        })).filter(item => item.name && item.text)
        for (const item of (data.list || []).flatMap(group => group.children || [])) {
          if (motionOf(item.animated_icon)) motions.push({ name: textOf(item.title) || '技能', src: item.animated_icon })
        }
        remember(sections, parts, section(title || '技能', [], cards, 'skill'))
      } else if (id === 'role_ascension') {
        remember(sections, parts, section(title || '突破', [], [], 'ascension', ascensionGroups(data.list)))
      } else if (id === 'driver_disk') {
        const cards = (data.disks_name || []).map((name, index) => ({ name: textOf(name), text: stripHtml(data.disks_desc?.[index]) }))
          .filter(item => item.name && item.text)
        remember(sections, parts, section(named(title, '驱动盘'), [], cards, 'disk'))
      } else if (id === 'double_col_table' || id === 'multi_table') {
        const sample = tableSample(data)
        if (/信赖|领取/.test(sample)) {
          remember(sections, parts, section(named(title, '信赖奖励'), [], [], 'ascension', rewardGroups(data)))
        } else {
          const cards = tableCards(data)
          const names = cards.slice(0, 2).map(item => item.name).join(' ')
          const focus = /影画/.test(title) || /^LEVEL\s?\d/i.test(names) ? 'cinema' : /故事|印象|CV/.test(title) ? 'story' : ''
          remember(sections, parts, section(named(title, focus === 'cinema' ? '影画' : '详情'), [], focus === 'cinema' ? cards : cards.slice(0, 8), focus))
        }
      } else if (id === 'map_desc') {
        const shots = (data.list || []).map(item => ({ name: textOf(item.tab_name), src: item.image })).filter(item => item.src)
        for (const shot of shots) if (motionOf(shot.src)) motions.push(shot)
        const focus = /影画|立绘|卡片|展示|动画/.test(title) ? 'portrait' : ''
        remember(sections, parts, section(named(title, '展示'), [], [], focus, [], shots.filter(shot => !motionOf(shot.src))))
      } else if (id === 'collapse_panel' || id === 'good_desc') {
        const focus = /故事|印象|CV/.test(title) ? 'story' : ''
        const clips = videosFromHtml(data.rich_text || data.desc)
        videos.push(...clips)
        const cards = cardsFromHtml(data.rich_text)
        const block = clips.length
          ? section(named(title, '视频'), [], [], 'video', [], [], clips)
          : cards.length
            ? section(named(title, '详情'), [], cards.slice(0, 8), focus)
            : section(named(title, '详情'), [data.rich_text || data.desc || ''], [], focus)
        remember(sections, parts, block)
      }
    }
  }
  const seen = new Set()
  const attrs = []
  for (const line of profile) {
    const [key, ...rest] = line.split('：')
    const value = rest.join('：')
    if (!key || !value || seen.has(key)) continue
    seen.add(key)
    attrs.push({ key, value })
  }
  const pick = name => attrs.find(item => item.key === name)?.value || ''
  return {
    id: String(page.id), name: shortName(page.name) || '未命名词条', icon: page.icon_url || '',
    tags: attrs.map(item => item.value), attrs: attrs.slice(0, 8),
    theme: { element: pick('属性'), weapon: pick('特性') || pick('类型'), rarity: pick('稀有度'), faction: pick('阵营'), portrait: portraits[0]?.src || '' },
    filters: {},
    sections: sections.filter(item => !item.focus || /profile|ascension|set/.test(item.focus)).slice(0, 3),
    all: sections.filter(item => item.focus !== 'story' && item.focus !== 'portrait'),
    motions, portraits, videos, parts,
    url: `${game.site}/content/${page.id}/detail`,
  }
}

function named(title, fallback) {
  return title && !/默认标题|暂无/.test(title) ? title : fallback
}

function ascensionGroups(list) {
  return (list || []).map(level => ({
    name: textOf(level.tabName || level.tab_name),
    materials: (level.materials || []).map(item => ({
      name: textOf(item.title || item.nickname || item.name),
      icon: item.icon || item.img || '',
      amount: item.amount || item.num || '',
    })).filter(item => item.name),
    note: (level.attr || []).map(item => {
      const value = Array.isArray(item.value) ? item.value.map(textOf).filter(Boolean).join('、') : textOf(item.value)
      return [textOf(item.key), value].filter(Boolean).join(' ')
    }).filter(Boolean).join('；'),
  })).filter(group => group.name && (group.materials.length || group.note))
}

function coneGroups(list) {
  return (list || []).map(level => ({
    name: textOf(level.name_),
    materials: (level.material || []).map(item => ({ name: textOf(item.name), icon: item.icon || '', amount: item.num || '' })).filter(item => item.name),
  })).filter(group => group.materials.length)
}

function collectGallery(data, portraits, videos) {
  for (const tab of data.list || []) {
    for (const item of tab.table || []) {
      const name = [textOf(item.name), textOf(item.append)].filter(Boolean).join(' · ')
      const page = articleOf(item.url)
      if (/视频/.test(tab.tabName || '') && page) videos.push({ name: name || '视频', page, cover: item.image || '' })
      else if (item.image && !page) portraits.push({ name: name || textOf(tab.tabName) || '图片', src: item.image })
    }
  }
}

function articleOf(value) {
  return String(value || '').match(/article\/(\d+)/)?.[1] || ''
}

function videosFromHtml(html) {
  return [...String(html || '').matchAll(/<a[^>]+href=\"([^\"]*article\/\d+[^\"]*)\"[^>]*>([\s\S]*?)<\/a>/gi)].map(item => ({
    name: textOf(item[2]) || '视频', page: articleOf(item[1]),
  })).filter(item => item.page)
}

function tableSample(data) {
  return (data.tables || []).flatMap(table => [textOf(table.tab_name), ...(table.header || []).map(textOf)]).join(' ')
}

function rewardGroups(data) {
  return (data.tables || []).flatMap(table => {
    const header = (table.header || []).map(textOf)
    const row = (table.row || [])[0]
    const cells = Array.isArray(row) ? row : Object.values(row || {})
    return cells.map((cell, index) => ({
      name: header[index] || `奖励${index + 1}`,
      materials: entriesFromHtml(cell),
    }))
  }).filter(group => group.materials.length)
}

function entriesFromHtml(html) {
  const source = String(html || '').replace(/\\"/g, '"')
  return [...source.matchAll(/data-entry-name=\"([^\"]+)\"[^>]*data-entry-amount=\"([^\"]*)\"[^>]*data-entry-img=\"([^\"]+)\"|data-entry-img=\"([^\"]+)\"[^>]*data-entry-name=\"([^\"]+)\"[^>]*data-entry-amount=\"([^\"]*)\"/g)].map(item => ({
    name: textOf(item[1] || item[5]),
    amount: item[2] || item[6] || '',
    icon: (item[3] || item[4] || '').split('?')[0],
  })).filter(item => item.name)
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

function wikiValue(value) {
  const text = textOf(value)
  if (!text || /^https?:/i.test(text)) return ''
  return ZZZ_CODES[text.toLowerCase()] || text
}

function baseLines(attr) {
  return Object.entries(attr || {}).slice(0, 8).map(([key, value]) => `${key}：${textOf(value?.value || value)}`).filter(line => !/：$/.test(line))
}

function tableCards(data) {
  return (data.tables || []).flatMap(table => {
    const group = textOf(table.tab_name)
    return (table.row || []).map(row => {
      const source = Array.isArray(row) ? row : Object.values(row || {})
      const icon = source.map(cell => String(cell).replace(/\\"/g, '"').match(/data-(?:image-url|entry-icon)="([^"]+)"/)?.[1] || '').find(Boolean) || ''
      const textCells = source.map(cell => stripHtml(cell)).filter(Boolean)
      if (textCells.length < 2) return { name: group, text: textCells[0] || '', icon, group: '' }
      return { name: textCells[0] || '', text: textCells.slice(1).join('\n'), icon, group }
    })
  }).filter(item => item.name && item.text)
}


export async function getGameEntry(key, id, hint = null) {
  const game = gameOf(key)
  const cacheKey = `${key}:${id}`
  const cached = cache.entries.get(cacheKey)
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.entry
  const entry = game.detail === 'rpg'
    ? formatRpg(game, (await requestJson(game, `${LIST_BASE}/common/blackboard/${game.app}/v1/content/info?app_sn=${game.app}&content_id=${encodeURIComponent(id)}`))?.content)
    : formatWiki(game, (await requestJson(game, `${ENTRY_BASE}/hoyowiki/wapi/entry_page?entry_page_id=${encodeURIComponent(id)}&lang=zh-cn`))?.page)
  if (!entry) throw new Error('词条内容为空')
  if (hint?.filters) applyFilters(entry, hint.filters)
  cache.entries.set(cacheKey, { time: Date.now(), entry })
  return entry
}

function applyFilters(entry, filters) {
  const pick = name => filters?.[name]?.[0] || ''
  for (const [key, value] of [['属性', pick('属性')], ['特性', pick('特性')], ['阵营', pick('阵营')], ['稀有度', pick('稀有度')]]) {
    if (!value || entry.attrs.some(item => item.key === key)) continue
    entry.attrs.push({ key, value })
  }
  entry.theme.element = entry.theme.element || pick('属性')
  entry.theme.weapon = entry.theme.weapon || pick('特性')
  entry.theme.rarity = entry.theme.rarity || pick('稀有度')
  entry.theme.faction = pick('阵营')
  entry.filters = filters
}

