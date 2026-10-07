import { aliasNames } from './alias.js'
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
  { id: 13, name: '背包', aliases: ['材料', '素材', '道具', '背包'], heavy: true },
  { id: 278, name: '灰眸', aliases: ['灰眸'] },
  { id: 255, name: '组织', aliases: ['组织', '势力'] },
  { id: 252, name: '成就', aliases: ['成就'], heavy: true },
  { id: 43, name: '任务', aliases: ['任务'], heavy: true },
  { id: 49, name: '动物', aliases: ['动物', '生物'] },
  { id: 68, name: '书籍', aliases: ['书籍', '书'] },
  { id: 55, name: '冒险家协会', aliases: ['冒险家协会', '协会', '每日委托', '委托'] },
  { id: 20, name: 'NPC', aliases: ['NPC', '商店', 'npc'], heavy: true },
  { id: 54, name: '秘境', aliases: ['秘境'] },
  { id: 65, name: '深境螺旋', aliases: ['深境螺旋', '深渊', '螺旋'] },
  { id: 249, name: '幻想真境剧诗', aliases: ['幻想真境剧诗', '剧诗'] },
  { id: 275, name: '幽境危战', aliases: ['幽境危战', '危战'] },
  { id: 109, name: '名片', aliases: ['名片'] },
  { id: 244, name: '头像', aliases: ['头像'] },
  { id: 233, name: '角色牌', aliases: ['角色牌'] },
  { id: 234, name: '行动牌', aliases: ['行动牌', '七圣召唤', '七圣'] },
  { id: 235, name: '魔物牌', aliases: ['魔物牌'] },
  { id: 130, name: '洞天', aliases: ['洞天', '尘歌壶', '家具'], heavy: true },
  { id: 105, name: '活动', aliases: ['活动'] },
  { id: 276, name: '供奉', aliases: ['供奉', '聚所', '地区供奉'] },
  { id: 211, name: '装扮', aliases: ['装扮'] },
  { id: 260, name: '酒馆挑战', aliases: ['酒馆挑战', '酒馆'] },
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
    .replace(/\\n/g, '\n').replace(/\\t/g, ' ')
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

// 观测枢词条的 alias_name 是空的，角色俗称只能在本地维护。
const CHARACTER_ALIASES = {
  薇斯纳: ['维纳斯', '薇纳斯', '薇奈斯', '维奈斯', '维纳', '维斯纳', '维斯娜'],
  沃雅妮莎: ['沃雅', '沃雅尼莎', '沃雅尼沙', '沃雅妮沙'],
  伊涅芙: ['伊涅'],
  菲林斯: ['菲林'],
  阿蕾奇诺: ['仆人', '阿蕾', '父亲'],
  哥伦比娅: ['哥伦'],
  雷电将军: ['雷神', '雷军', '雷电影', '影', '巴尔', '巴尔泽布'],
  茜特菈莉: ['茜特'],
  八重神子: ['神子', '八重', '宫司'],
  莱欧斯利: ['莱欧', '公爵'],
  梦见月瑞希: ['瑞希'],
  赛诺: ['大风纪官'],
  玛薇卡: ['火神', '马薇卡'],
  班尼特: ['班尼', '点赞', '点赞侠'],
  香菱: ['锅巴'],
  菲谢尔: ['皇女'],
  菈乌玛: ['菈乌'],
  奈芙尔: ['奈芙'],
  克洛琳德: ['琳德'],
  娜维娅: ['娜维'],
  林尼: ['白猫'],
  琳妮特: ['黑猫'],
  丝柯克: ['斯科克'],
  爱可菲: ['可菲'],
  塔利雅: ['塔利'],
  优菈: ['优拉'],
  可莉: ['火花骑士', '嘟嘟可'],
  迪卢克: ['卢姥爷'],
  琴: ['团长'],
  那维莱特: ['那维', '水龙', '最高审判官'],
  '奇偶·男性': ['空', '男主'],
  '奇偶·女性': ['荧', '女主'],
  芙宁娜: ['水神', '芙芙', '芙卡洛斯'],
  纳西妲: ['草神', '小草神', '草王', '布耶尔', '小吉祥草王'],
  妮露: ['尼露'],
  艾尔海森: ['海森', '书记官'],
  流浪者: ['散兵', '国崩', '斯卡拉'],
  提纳里: ['小鹿'],
  迪希雅: ['希雅'],
  玛拉妮: ['鲨鱼'],
  申鹤: ['神鹤'],
  神里绫华: ['绫华', '神里'],
  神里绫人: ['绫人', '神里'],
  珐露珊: ['法露珊'],
  荒泷一斗: ['一斗', '荒泷'],
  宵宫: ['烟花', '霄宫'],
  九条裟罗: ['裟罗'],
  希诺宁: ['希诺'],
  温迪: ['巴巴托斯', '风神'],
  闲云: ['留云'],
  北斗: ['大姐头'],
  刻晴: ['玉衡', '阿晴'],
  甘雨: ['椰羊'],
  魈: ['降魔大圣', '金鹏'],
  达达利亚: ['公子', '达达鸭'],
  钟离: ['岩王帝君', '岩神', '摩拉克斯', '帝君'],
  胡桃: ['胡堂主', '堂主'],
  枫原万叶: ['万叶'],
  夜兰: ['夜栏'],
  珊瑚宫心海: ['心海', '军师'],
  鹿野院平藏: ['平藏'],
  久岐忍: ['忍', '阿忍'],
  凯亚: ['骑兵队长'],
  安柏: ['侦察骑士'],
  七七: ['肚饿'],
  凝光: ['天权'],
  '旅行者·冰': ['冰主', '冰旅行者'],
  '旅行者·水': ['水主', '水旅行者'],
  '旅行者·火': ['火主', '火旅行者'],
  '旅行者·雷': ['雷主', '雷旅行者'],
  '旅行者·岩': ['岩主', '岩旅行者'],
  '旅行者·风': ['风主', '风旅行者'],
  '旅行者·草': ['草主', '草旅行者'],
}

const ENTRY_ALIASES = {
  饰金之梦: ['饰金', '饰金套', '饰金四件'],
}

const ALIAS_INDEX = new Map()
for (const table of [CHARACTER_ALIASES, ENTRY_ALIASES]) {
  for (const [name, aliases] of Object.entries(table)) {
    for (const alias of aliases) {
      const key = normalizeName(alias)
      if (!key) continue
      if (!ALIAS_INDEX.has(key)) ALIAS_INDEX.set(key, [])
      if (!ALIAS_INDEX.get(key).includes(name)) ALIAS_INDEX.get(key).push(name)
    }
  }
}

function aliasTargets(keyword) {
  const local = ALIAS_INDEX.get(normalizeName(keyword)) || []
  return [...new Set([...local, ...aliasNames('gs', keyword)])]
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
  { id: 'recommend', name: '推荐', aliases: ['推荐', '配装', '搭配'] },
  { id: 'profile', name: '资料', aliases: ['资料', '属性', '档案', '信息'] },
  { id: 'voice', name: '配音', aliases: ['配音', '声优', 'CV'] },
  { id: 'portrait', name: '立绘', aliases: ['立绘', '原画', '全身'] },
  { id: 'showcase', name: '展示', aliases: ['展示', '角色展示', '动作', '待机'] },
  { id: 'detail', name: '全文', aliases: ['全文', '详细', '详情'] },
]

export const WIKI_FOCUS_PATTERN = WIKI_FOCUS
  .flatMap(focus => focus.aliases)
  .sort((a, b) => b.length - a.length)
  .join('|')

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
    const filters = parseChannelFilters(channel.ch_ext)
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
        filters: parseItemFilters(item.ext),
        filterSchema: filters,
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

  const mapped = aliasTargets(keyword).some(target => normalizeName(target) === name)
  let score = Math.max(rank(name), rank(alias), mapped ? 100 : 0)
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

  const mapped = aliasTargets(text)
  const searchText = channelId && mapped.length === 1 ? mapped[0] : text

  if (channelId) {
    for (const item of await getChannelItems(channelId)) add(item)
  } else {
    try {
      for (const item of await searchRemote(searchText)) add(item)
    } catch (err) {
      logger.warn('[观测枢图鉴] 搜索接口失败，改用图鉴目录:', err.message || err)
    }
  }

  let results = [...collected.values()]
    .map(item => ({ ...item, score: scoreItem(item, text) }))
    .filter(item => item.score >= 95)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)

  if (!results.length && !channelId) {
    const lists = await Promise.all(
      WIKI_CHANNELS.filter(channel => !channel.heavy).map(channel => getChannelItems(channel.id).catch(() => [])),
    )
    for (const items of lists) items.forEach(add)
    results = [...collected.values()]
      .map(item => ({ ...item, score: scoreItem(item, text) }))
      .filter(item => item.score >= 95)
      .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
  }

  return results.slice(0, limit)
}

async function catalogItems(channelId = 0) {
  const channels = channelId ? WIKI_CHANNELS.filter(channel => channel.id === channelId) : WIKI_CHANNELS
  const lists = await Promise.all(channels.map(channel => getChannelItems(channel.id).catch(() => [])))
  return lists.flat()
}

export const CATALOG_PAGE_SIZE = 24

const FILTER_ALIASES = [
  ['五星', ['5星']],
  ['四星', ['4星']],
  ['三星', ['3星']],
  ['二星', ['2星']],
  ['一星', ['1星']],
  ['单手剑', ['单手']],
  ['双手剑', ['双手', '大剑', '重剑']],
  ['长柄武器', ['长柄', '长枪']],
  ['蒙德城', ['蒙德']],
  ['璃月港', ['璃月']],
  ['稻妻城', ['稻妻']],
  ['须弥城', ['须弥']],
  ['枫丹廷', ['枫丹']],
  ['至冬', ['至冬国']],
  ['始基力 荒', ['始基力荒']],
  ['始基力 芒', ['始基力芒']],
]

function parseJsonText(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function parseChannelFilters(value) {
  const ext = parseJsonText(value, [])
  const raw = (Array.isArray(ext) ? ext : []).find(item => item?.attribute_key === 'filter')?.value
  const groups = parseJsonText(raw, [])
  return (Array.isArray(groups) ? groups : [])
    .map(group => ({
      label: String(group?.label || '').trim(),
      options: (group?.children || []).map(child => String(child?.label || '').trim()).filter(Boolean),
    }))
    .filter(group => group.label && group.options.length)
}

function parseItemFilters(value) {
  const ext = parseJsonText(value, {})
  const bag = Object.values(ext || {}).map(item => item?.filter?.text).find(Boolean)
  const tags = parseJsonText(bag, [])
  const filters = {}
  for (const tag of Array.isArray(tags) ? tags : []) {
    const text = String(tag || '')
    const slash = text.indexOf('/')
    if (slash <= 0) continue
    const key = text.slice(0, slash).trim()
    const option = text.slice(slash + 1).trim()
    if (!key || !option) continue
    if (!filters[key]) filters[key] = []
    if (!filters[key].includes(option)) filters[key].push(option)
  }
  return filters
}

function filterWords(option) {
  const text = String(option || '').trim()
  const words = new Set([text, text.replace(/\s+/g, '')])
  for (const [name, aliases] of FILTER_ALIASES) {
    if (text === name || aliases.includes(text)) {
      words.add(name)
      aliases.forEach(alias => words.add(alias))
    }
  }
  return [...words].filter(Boolean).sort((a, b) => b.length - a.length)
}

function matchFilter(filters, token) {
  const query = String(token || '').replace(/\s+/g, '')
  if (!query) return false
  for (const values of Object.values(filters || {})) {
    for (const value of values) {
      if (filterWords(value).some(word => word.replace(/\s+/g, '') === query)) return true
    }
  }
  return false
}

export async function listWikiChannel(channel, page = 1, filters = []) {
  const items = await getChannelItems(channel.id)
  const wanted = [...new Set((filters || []).map(item => String(item || '').trim()).filter(Boolean))]
  const matched = wanted.length
    ? items.filter(item => wanted.every(token => matchFilter(item.filters, token)))
    : items
  const size = CATALOG_PAGE_SIZE
  const totalPage = Math.max(1, Math.ceil(matched.length / size))
  const current = Math.max(1, page)
  const start = (current - 1) * size
  return {
    channel,
    page: current,
    totalPage,
    total: matched.length,
    filters: wanted,
    schema: items[0]?.filterSchema || [],
    items: matched.slice(start, start + size),
  }
}

export async function getWikiCalendar(days = 7) {
  const cached = cache.lists.get('calendar')
  const fresh = !cached || Date.now() - cached.time >= CACHE_TTL
  const data = fresh
    ? await requestJson(`${LIST_BASE}/common/blackboard/${APP_SN}/v1/get_activity_calendar?app_sn=${APP_SN}`)
    : cached.items
  if (fresh) cache.lists.set('calendar', { time: Date.now(), items: data })

  const span = Math.min(14, Math.max(1, Number(days) || 7))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const week = ['日', '一', '二', '三', '四', '五', '六']
  const rows = []

  for (let offset = 0; offset < span; offset += 1) {
    const date = new Date(today.getTime() + offset * 86400000)
    const month = date.getMonth() + 1
    const day = date.getDate()
    const weekday = date.getDay() || 7
    const start = Math.floor(date.getTime() / 1000)
    const end = start + 86400
    const birthdays = []
    const talent = new Map()
    const weapon = new Map()

    for (const item of data?.list || []) {
      if (String(item.kind) === '4') {
        const time = Number(item.start_time)
        if (time >= start && time < end) {
          const name = String(item.title || '').replace(/^今天是|今天的/, '').replace(/的生日.*$/, '').trim()
          if (name) birthdays.push({ name, icon: item.img_url || '' })
        }
        continue
      }
      if (String(item.kind) !== '2' || weekday === 7) continue
      if (!(item.drop_day || []).map(Number).includes(weekday)) continue
      const bucket = String(item.break_type) === '1' ? weapon : talent
      const material = item.contentInfos?.[0]
      const book = String(material?.title || '').split(/的|之/)[0]
      const key = book || material?.title
      if (!key || bucket.has(key)) continue
      bucket.set(key, { name: material.title, icon: material.icon || '' })
    }

    rows.push({
      label: offset === 0 ? '今天' : offset === 1 ? '明天' : `${month}月${day}日`,
      date: `${month}月${day}日`,
      week: '周' + week[date.getDay()],
      birthdays,
      talent: weekday === 7 ? [] : [...talent.values()],
      weapon: weekday === 7 ? [] : [...weapon.values()],
      open: weekday === 7,
    })
  }

  return { rows }
}

export function parseCatalogQuery(input = '') {
  const text = String(input).replace(/^#?g?图鉴(?:目录|列表|分类)\s*/, '').trim()
  const tokens = text.split(/\s+/).filter(Boolean)
  let channel = null
  let page = 1
  const filters = []
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
    filters.push(token)
  }
  return { channel, page, filters }
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

function pushSection(sections, title, lines, collapse = false, groups = [], total = [], cards = [], images = [], videos = []) {
  const content = (Array.isArray(lines) ? lines : [lines]).map(line => String(line || '').trim()).filter(Boolean)
  const materialGroups = (groups || []).filter(group => group.materials?.length)
  const cardItems = (cards || []).filter(card => card?.name || card?.text || card?.icon)
  const pictures = (images || []).filter(item => item?.src)
  const clips = (videos || []).filter(item => item?.src)
  if (!content.length && !materialGroups.length && !cardItems.length && !pictures.length && !clips.length) return
  const limit = collapse ? 1800 : 4000
  sections.push({
    title: title || '详情',
    text: content.join('\n').length > limit ? clipText(content.join('\n'), limit) : content.join('\n'),
    groups: materialGroups,
    total: total || [],
    cards: cardItems,
    images: pictures,
    videos: clips,
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

function effectCards(attrs) {
  return attrPairs(attrs, 8)
    .filter(attr => /件套|效果|精炼|特效/.test(attr.key))
    .map(attr => ({ name: attr.key, text: attr.value }))
}

function weaponEffect(html) {
  const text = stripHtml(html)
  const matched = text.match(/精炼(?:\([^)]*\))?阶\s*([\s\S]*?)(?:\n\n|$)/)
  if (!matched) return []
  const body = matched[1].replace(/^[·\s]+/, '').trim()
  const name = body.split(/[·：:]/)[0].trim()
  return body ? [{ name: name && name.length <= 16 ? name : '武器效果', text: body.replace(new RegExp(`^${name}\\s*[·：:]?\\s*`), '') || body }] : []
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
    const desc = proseOf(item.desc)
    const scaling = scalingOf(item.attr)
    if (title || desc || scaling) {
      talents.push({
        name: title,
        text: desc,
        icon: item.icon || '',
        scaling,
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

function scalingOf(table) {
  const header = table?.header || []
  const rows = table?.row || []
  if (header.length < 2 || !rows.length) return null
  const levels = header.slice(1).map(cellText)
  const body = rows.map(cells => {
    const name = cellText(cells?.[0])
    if (!name || /升级材料/.test(name)) return null
    return { name, values: cells.slice(1).map(cellText) }
  }).filter(row => row && row.values.some(Boolean))
  return body.length ? { levels, rows: body } : null
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

function videoFromHtml(value) {
  const html = String(value ?? '')
  const src = html.match(/data-video-url="([^"]+)"/)?.[1] || ''
  if (!src) return null
  const name = stripHtml(html).split('\n').find(Boolean) || ''
  return { name, src }
}

function proseOf(value) {
  const quotes = []
  const body = String(value ?? '').replace(/<p>(?:\s|&nbsp;)*([「“][\s\S]*?[」”])(?:\s|&nbsp;)*<\/p>/gi, (_, quote) => {
    const text = stripHtml(quote).trim()
    if (text) quotes.push(text)
    return ''
  })
  const text = stripHtml(body)
  return quotes.length ? `${text}\n\n${quotes.join('\n')}`.trim() : text
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

function placeholderTitle(value) {
  const text = stripHtml(value)
  return text && !/默认标题|暂无/.test(text) ? text : ''
}

function cleanLabel(value) {
  return stripHtml(value).replace(/默认标题/g, '').replace(/^[：:|｜\s]+|[：:|｜\s]+$/g, '').trim()
}

function voiceActors(html) {
  const labels = { 中: '中', 汉: '中', 日: '日', 英: '英', 韩: '韩' }
  const found = []
  const seen = new Set()
  const add = (label, name) => {
    const actor = String(name || '').trim()
    if (!actor || seen.has(label)) return
    seen.add(label)
    found.push(`${label}：${actor}`)
  }
  const source = String(html ?? '')
  for (const line of stripHtml(source).split('\n')) {
    const matched = line.trim().match(/^([中汉日英韩])(?:[文语])?(?:语)?\s*(?:CV|cv|配音)?\s*[：:]\s*(.+)$/)
    if (matched) add(labels[matched[1]], matched[2])
  }
  if (found.length >= 2) return found
  for (const match of source.matchAll(/([中汉日英韩])(?:[文语])?(?:语)?\s*(?:CV|cv|配音)?\s*[：:]\s*([^<\n]+)/g)) {
    add(labels[match[1]], stripHtml(match[2]))
  }
  return found
}

function parseTables(data) {
  const lines = []
  const cards = []
  for (const table of data?.tables || []) {
    const title = stripHtml(table?.tab_name || table?.title || table?.name || '')
    const rows = table?.row || table?.rows || table?.list || table?.data || []
    const visual = rows.some(row => {
      const cells = Array.isArray(row) ? row : []
      return entriesFromHtml(cells[0]).length || imagesFromHtml(cells[0]).length
    })
    if (!visual) {
      const pictures = rows.flatMap(row => {
        const cells = Array.isArray(row) ? row : []
        return cells.flatMap(cell => imagesFromHtml(cell).map(src => ({ src, text: cellText(cell) })))
      }).filter(item => item.src && !/成长数据/.test(item.text))
      if (pictures.length) {
        pictures.slice(0, 6).forEach(item => cards.push({ group: placeholderTitle(title), name: cleanLabel(item.text) || '推荐', icon: item.src }))
        continue
      }
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

    const limit = /推荐/.test(title) ? 8 : 8
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
      const group = placeholderTitle(title)
      if (entries.length) {
        entries.forEach(entry => cards.push({
          group,
          name: entry.name,
          icon: entry.icon,
          text: reason,
        }))
      } else if (images.length === 1 && !/成长数据/.test(label)) {
        const text = cellText(cells[0])
        cards.push({
          group,
          name: cleanLabel(text) || text,
          icon: images[0],
          text: reason,
        })
      } else {
        const text = cells.map(cellText).filter(Boolean).join('：')
        if (text && !/成长数据/.test(text)) cards.push({ group, name: cleanLabel(text) || text })
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
    const cards = [...effectCards(data?.attr), ...weaponEffect(data?.rich_text)]
    const flavor = stripHtml(data?.rich_text).replace(/精炼(?:\([^)]*\))?阶\s*[\s\S]*?(?:\n\n|$)/, '').trim()
    return { title: cards.length ? '装备描述' : title, lines: flavor ? [flavor] : [], cards }
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
    return { title, lines: parsed.lines, cards: parsed.cards, focus: /推荐/.test(title) ? 'recommend' : '' }
  }
  if (id === 'map_desc') {
    const images = (data.list || [])
      .filter(item => item?.image && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(item.image))
      .map(item => ({ name: stripHtml(item.tab_name || item.name || ''), src: item.image, motion: /\.gif(\?|$)/i.test(item.image) }))
    if (!images.length) return null
    const stills = images.filter(item => !item.motion)
    const motions = images.filter(item => item.motion)
    if (stills.length && !motions.length) {
      return { title, lines: [], images: stills, focus: 'portrait' }
    }
    return { title, lines: [], images: motions.length ? motions : images, portraits: stills.length && motions.length ? stills : [] }
  }
  if (id === 'artifact_list_v2') {
    const card = parseArtifact(data, moduleName)
    return card ? { title: '圣遗物件', lines: [], cards: [card] } : null
  }
  if (id === 'rich_base_info') {
    const cards = effectCards(data?.list || data?.attr)
    return { title: cards.length ? '套装效果' : title, lines: [], cards }
  }
  if (id === 'collapse_panel' || id === 'rich_text') {
    const voices = /角色CV|配音/.test(title) ? voiceActors(data?.rich_text) : []
    if (voices.length) return { title: '配音', lines: voices, cards: voices.map(line => ({ name: line })), focus: 'voice' }
    const video = videoFromHtml(data?.rich_text)
    if (video) return { title: title || '角色视频', lines: [], videos: [video] }
    return { title, lines: [stripHtml(data?.rich_text)], collapse: true }
  }
  if (id === 'business_card') {
    const images = [data.long_img, data.card_img]
      .filter(src => src && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(src))
      .map((src, index) => ({ name: index ? '名片' : '获取界面', src, motion: false }))
    return images.length ? { title: '名片', lines: [], images, focus: 'portrait' } : null
  }
  if (['role_voice', 'strategy', 'timeline_base_info', 'interactive_dialogue', 'card_group_info'].includes(id)) {
    return null
  }
  const video = videoFromHtml(data?.rich_text)
  if (video) return { title: title || '角色视频', lines: [], videos: [video] }
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

const BRIEF = /基础资料|基础属性|套装效果|装备描述|推荐装备|推荐角色|搭配推荐|特殊料理|突破|成长数值|升级材料/
const PROFILE_TITLE = /基础资料|基础信息|基础属性|套装效果|装备描述/
const ASCENSION_TITLE = /突破|成长数值|升级材料/

function focusOf(title = '', images = []) {
  if (/天赋/.test(title)) return 'talent'
  if (/角色CV|配音/.test(title) && !/展示|语音/.test(title)) return 'voice'
  if (/命之座|命座/.test(title)) return 'constellation'
  if (ASCENSION_TITLE.test(title)) return 'ascension'
  if (/故事|神之眼|更多描述|角色详细/.test(title)) return 'story'
  if (/推荐/.test(title)) return 'recommend'
  if (PROFILE_TITLE.test(title)) return 'profile'
  if (/展示/.test(title) && images.length) {
    const still = images.every(item => !item.motion)
    return still ? 'portrait' : 'showcase'
  }
  if (/视频|PV|演示|预告/.test(title)) return 'video'
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
      if (!parsed) continue
      const hasContent = parsed.lines?.some(Boolean) || parsed.groups?.length || parsed.cards?.length || parsed.images?.length || parsed.videos?.length || parsed.portraits?.length
      if (!hasContent) continue
      const focus = parsed.focus || (parsed.videos?.length ? 'video' : focusOf(parsed.title, parsed.images || []))
      if (focus === 'portrait' && parsed.title !== '名片') parsed.images = (parsed.images || []).map(item => ({ ...item, name: '' }))
      pending.push({ ...parsed, focus })
    }
  }

  pending.sort((a, b) => (BRIEF.test(b.title) ? 1 : 0) - (BRIEF.test(a.title) ? 1 : 0))
  const ordered = [
    ...pending.filter(item => item.focus !== 'story'),
    ...pending.filter(item => item.focus === 'story'),
  ]

  for (const parsed of ordered) {
    const previous = sections.find(section => {
      if (section.title !== parsed.title || section.focus !== parsed.focus) return false
      const sectionStill = !(section.images || []).some(item => item.motion)
      const parsedStill = !(parsed.images || []).some(item => item.motion)
      return sectionStill === parsedStill
    })
    if (previous) {
      previous.cards = [...(previous.cards || []), ...(parsed.cards || [])]
      previous.groups = [...(previous.groups || []), ...(parsed.groups || [])]
      previous.total = [...(previous.total || []), ...(parsed.total || [])]
      previous.images = [...(previous.images || []), ...(parsed.images || [])]
      previous.portraits = [...(previous.portraits || []), ...(parsed.portraits || [])]
      previous.videos = [...(previous.videos || []), ...(parsed.videos || [])]
      if (parsed.lines?.length) previous.text = [previous.text, ...parsed.lines].filter(Boolean).join('\n')
      continue
    }
    const key = [
      parsed.focus,
      parsed.title,
      (parsed.images || []).some(item => item.motion) ? 'motion' : 'still',
      parsed.lines.join('\n'),
    ].join('\0')
    if (seen.has(key)) continue
    seen.add(key)
    pushSection(sections, parsed.title, parsed.lines, parsed.collapse, parsed.groups, parsed.total, parsed.cards, parsed.images, parsed.videos)
    const current = sections[sections.length - 1]
    if (current) {
      current.focus = parsed.focus
      current.portraits = parsed.portraits || []
    }
  }

  const portraits = [
    ...sections.flatMap(section => section.focus === 'portrait' ? section.images : []),
    ...sections.flatMap(section => section.portraits || []),
  ]
  const motions = sections.flatMap(section => section.focus === 'showcase' ? section.images.filter(item => item.motion) : [])
  const videos = sections.flatMap(section => section.videos || [])
  const character = isCharacterPage(page)
  const weapon = (page.modules || []).some(module => (module.components || []).some(component => component.component_id === 'equipment_base_info'))
  const artifact = (page.modules || []).some(module => (module.components || []).some(component => component.component_id === 'artifact_list_v2'))
  const voices = sections.filter(section => section.focus === 'voice')
  const wanted = character
    ? ['profile', 'talent', 'ascension', 'recommend']
    : (weapon || artifact ? ['profile', 'ascension', 'recommend'] : ['profile', 'ascension'])
  const picked = []
  for (const id of wanted) {
    for (const found of sections.filter(section => section.focus === id)) picked.push(found)
  }
  if (character) picked.push(...voices)
  if (weapon && !picked.some(section => section.focus === 'recommend')) {
    picked.push({ title: '推荐角色', text: '', lines: [], cards: [], groups: [], total: [], images: [], videos: [], focus: 'recommend', empty: '暂无推荐角色' })
  }
  const overview = picked.length ? picked : sections.filter(section => BRIEF.test(section.title) && section.focus !== 'video').slice(0, 3)

  return {
    id: String(page.id),
    name: page.name || '未命名词条',
    icon: header.icon,
    tags: header.tags,
    attrs: header.attrs,
    theme: { ...header.theme, portrait: portraits[0]?.src || '' },
    sections: overview,
    all: sections.filter(section => section.focus !== 'video' && section.focus !== 'portrait' && section.focus !== 'showcase'),
    portraits,
    motions,
    videos,
    parts: Object.fromEntries(['talent', 'constellation', 'ascension', 'story', 'profile', 'recommend', 'voice', 'portrait', 'showcase']
      .map(id => [id, sections.filter(section => section.focus === id)])
      .filter(([, list]) => list.length)),
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

