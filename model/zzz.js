import {
  cardsFromHtml, entriesFromHtml, motionOf, named, parseJson, peopleFromHtml, remember, section, shortName, stillOf, stripHtml, tableCards, textOf, registerGame,
} from './games.js'

const ZZZ_CODES = {
  ether: '以太', fire: '火', ice: '冰', electric: '电', physic: '物理', physics: '物理', physical: '物理',
  wind: '风', frost: '烈霜', lumino: '流明', blade: '凛刃', ink: '玄墨',
  support: '支援', attack: '强攻', stun: '击破', anomaly: '异常', abnormal: '异常', defense: '防护',
  rupture: '命破', guard: '锋御',
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
        const facts = [
          ['属性', data.role_attribute],
          ['特性', data.role_profession],
          ['稀有度', data.grade],
          ['阵营', data.addition_text],
          ...(data.custom_field || []).map(item => [item.key, item.value]),
        ].map(([key, value]) => [key, wikiValue(value)]).filter(([, value]) => value && !/^https?:/i.test(value))
          .map(([key, value]) => `${key}：${value}`)
        profile.push(...facts, ...baseLines(data.attr))
        if (data.tachie_pc || data.tachie_m) portraits.push({ name: '角色立绘', src: data.tachie_pc || data.tachie_m })
        remember(sections, parts, section(title || '基础资料', facts, [], 'profile'))
      } else if (id === 'rich_row_base_info' && /角色/.test(JSON.stringify(data.rich_text || ''))) {
        const intro = stripHtml(data.rich_text)
          .replace(/【\s*角色\s*TAG\s*】\s*[：:]?\s*/g, '定位：')
          .replace(/【\s*角色详情\s*】\s*[：:]?\s*/g, '\n简介：')
          .replace(/[ \t]+\n/g, '\n')
        const lines = intro.split('\n').map(line => line.trim()).filter(Boolean)
        profile.push(...lines)
        const brief = lines.find(line => line.startsWith('简介：'))
        const text = brief ? brief.replace(/^简介：/, '') : lines.filter(line => !line.includes('：')).join('\n')
        if (text) remember(sections, parts, section('角色简介', [text], [], 'story'))
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
          name: [textOf(item.tab_name), textOf(item.title)].filter(Boolean).join(' · ') || textOf(item.title),
          text: stripHtml(item.desc), icon: item.icon || item.animated_icon || '',
          scaling: growthScaling(item.growth),
        })).filter(item => item.name && item.text && !/职级晋升|滑动滑块|词条释义/.test(item.text))
        const promotions = (data.list || []).flatMap(item => item.children || []).flatMap(item => promotionGroups(item.growth))
        if (promotions.length) remember(sections, parts, section(title || '突破', [], [], 'ascension', promotions))
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
        const headers = (data.tables || []).flatMap(table => table.header || []).map(textOf).join(' ')
        if (/信赖|领取/.test(sample)) {
          remember(sections, parts, section(named(title, '信赖奖励'), [], [], 'ascension', rewardGroups(data)))
        } else if (/二件套|四件套/.test(headers)) {
          const cards = (data.tables || []).flatMap(table => (table.header || []).map((name, index) => ({
            name: textOf(name),
            text: stripHtml((table.row?.[0] || [])[index] || ''),
          }))).filter(item => item.name && item.text)
          remember(sections, parts, section('套装效果', [], cards, 'set'))
        } else if (/推荐角色/.test(headers)) {
          const cards = (data.tables || []).flatMap(table => (table.row || []).flatMap(row => {
            const cells = Array.isArray(row) ? row : Object.values(row || {})
            return peopleFromHtml(cells.join(''))
          })).filter(card => card.name && card.icon)
          remember(sections, parts, section('推荐角色', [], cards, 'recommend', [], [], [], cards.length ? '' : '暂无推荐角色'))
        } else if (/推荐(?:音擎|驱动盘|配队)/.test(headers)) {
          const cards = tableCards(data).map(card => ({ ...card, group: '' })).filter(card => card.name && card.name !== '默认标题')
          const label = headers.match(/推荐(?:音擎|驱动盘|配队)/)?.[0] || '推荐'
          remember(sections, parts, section(named(title, label), [], cards, 'recommend'))
        } else if (/音擎效果|驱动盘效果/.test(headers)) {
          const text = (data.tables || []).flatMap(table => (table.row || []).flatMap(row => (Array.isArray(row) ? row : Object.values(row)).map(stripHtml))).filter(item => item && item !== '暂无')
          remember(sections, parts, section('效果', text, [], 'effect'))
        } else {
          const cards = tableCards(data)
          const names = cards.slice(0, 2).map(item => item.name).join(' ')
          const focus = /影画/.test(title) || /^LEVEL\s?\d/i.test(names) ? 'cinema' : /故事|印象|CV/.test(title) ? 'story' : ''
          remember(sections, parts, section(named(title, focus === 'cinema' ? '影画' : '详情'), [], focus === 'cinema' ? cards : cards.slice(0, 8), focus))
        }
      } else if (id === 'map_desc') {
        const shots = (data.list || []).map(item => ({ name: textOf(item.tab_name), src: item.image })).filter(item => item.src)
        for (const shot of shots) if (motionOf(shot.src)) motions.push(shot)
        const focus = 'portrait'
        remember(sections, parts, section(named(title, '展示'), [], [], focus, [], shots.filter(shot => !motionOf(shot.src))))
      } else if (id === 'collapse_panel' || id === 'good_desc') {
        const voices = /角色CV|配音/.test(title) && !/展示|语音/.test(title) ? voiceLines(data.rich_text || data.desc) : []
        if (voices.length) {
          remember(sections, parts, section('配音', voices, [], 'voice'))
          continue
        }
        const focus = /故事|印象|CV/.test(title) ? 'story' : (/效果|描述/.test(title) ? 'effect' : '')
        const clips = videosFromHtml(data.rich_text || data.desc)
        videos.push(...clips)
        const cards = cardsFromHtml(data.rich_text)
        const plain = stripHtml(data.rich_text || data.desc || '')
        const block = clips.length
          ? section(named(title, '视频'), [], [], 'video', [], [], clips)
          : cards.length && focus !== 'effect'
            ? section(named(title, '详情'), [], cards.slice(0, 8), focus)
            : section(named(title, focus === 'effect' ? '效果' : '详情'), plain && plain !== '暂无' ? [plain] : [], [], focus)
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
  const agent = sections.some(item => item.focus === 'skill')
  const disk = sections.some(item => item.focus === 'disk' || item.focus === 'set')
  const engine = sections.some(item => item.focus === 'effect') && !agent && !disk
  const voices = sections.filter(item => item.focus === 'voice')
  const overview = agent
    ? ['profile', 'story', 'ascension', 'recommend'].flatMap(id => sections.filter(item => item.focus === id && (id === 'story' ? item.title === '角色简介' : id !== 'profile' || item.title === '基础资料')))
    : ['effect', 'set', 'ascension', 'recommend'].flatMap(id => sections.filter(item => item.focus === id && (id !== 'set' || item.title === '套装效果')))
  if (agent) overview.push(...voices)
  if (engine && !overview.some(item => item.focus === 'recommend')) {
    overview.push({ title: '推荐角色', text: '', lines: [], cards: [], groups: [], images: [], videos: [], focus: 'recommend', empty: '暂无推荐角色' })
  }
  return {
    id: String(page.id), name: shortName(page.name) || '未命名词条', icon: page.icon_url || '',
    tags: attrs.map(item => item.value), attrs: attrs.slice(0, 8),
    theme: { element: pick('属性'), weapon: pick('特性') || pick('类型'), rarity: pick('稀有度'), faction: pick('阵营'), portrait: portraits[0]?.src || '' },
    filters: {},
    sections: overview.length ? overview : sections.filter(item => item.focus !== 'story' && item.focus !== 'portrait' && item.focus !== 'video').slice(0, 3),
    all: sections.filter(item => item.focus !== 'story' && item.focus !== 'portrait'),
    motions, portraits, videos, parts,
    url: `${game.site}/content/${page.id}/detail`,
  }
}



function growthScaling(growth) {
  const levels = []
  const rows = []
  for (const level of growth || []) {
    const label = textOf(level.name)
    if (!label || /总计/.test(label)) continue
    const values = new Map()
    for (const child of level.children || []) {
      const cells = child.row?.[0] || []
      for (const line of stripHtml(cells.join('\n')).split('\n')) {
        const matched = line.match(/^(.+?)[：:]\s*(.+)$/)
        if (!matched) continue
        if (!values.has(matched[1])) values.set(matched[1], [])
        values.get(matched[1]).push(matched[2])
      }
    }
    if (!values.size) continue
    levels.push(label)
    for (const [name, list] of values) {
      let row = rows.find(item => item.name === name)
      if (!row) {
        row = { name, values: [] }
        rows.push(row)
      }
      while (row.values.length < levels.length - 1) row.values.push('')
      row.values.push(list.join(' / '))
    }
  }
  for (const row of rows) while (row.values.length < levels.length) row.values.push('')
  return levels.length && rows.length ? { levels, rows } : null
}

function promotionGroups(growth) {
  const groups = []
  for (const level of growth || []) {
    const label = textOf(level.name)
    if (!/总计|突破|晋升|晋阶/.test(label)) continue
    const materials = (level.children || []).flatMap(child => (child.row || []).flat().flatMap(entriesFromHtml))
    const seen = new Set()
    const unique = materials.filter(item => {
      const key = item.name + item.amount
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (unique.length) groups.push({ name: /总计/.test(label) ? '满级合计' : label, materials: unique })
  }
  return groups
}

function ascensionGroups(list) {
  const levels = list || []
  const numbered = levels.map(level => Number(String(level.tabName || level.tab_name || '').match(/\d+/)?.[0] || 0))
  const maxLevel = Math.max(0, ...numbered)
  const shown = maxLevel ? levels.filter((_, index) => numbered[index] === maxLevel) : levels
  return shown.map(level => ({
    name: textOf(level.tabName || level.tab_name),
    materials: (level.materials || []).map(item => ({
      name: textOf(item.title || item.nickname || item.name),
      icon: item.icon || item.img || '',
      amount: item.amount || item.num || '',
    })).filter(item => item.name),
    note: attrNote(level.attr),
    stats: attrStats(level.attr),
  })).filter(group => group.name && (group.materials.length || group.note))
}

function attrPairs(attr) {
  return (attr || []).map(item => {
    const value = Array.isArray(item.value) ? item.value.map(textOf).filter(Boolean).join('、') : textOf(item.value)
    return [textOf(item.key), value]
  }).filter(([key, value]) => key && value)
}

function attrNote(attr) {
  return attrPairs(attr).filter(([key]) => !/晋阶前|晋阶后/.test(key)).map(([key, value]) => key + ' ' + value).join('；')
}

function attrStats(attr) {
  const pairs = attrPairs(attr).filter(([key]) => /晋阶前|晋阶后/.test(key))
  if (!pairs.length) return null
  const rows = []
  for (const [key, value] of pairs) {
    const name = key.replace(/晋阶前|晋阶后/g, '')
    let row = rows.find(item => item.name === name)
    if (!row) {
      row = { name, values: ['', ''] }
      rows.push(row)
    }
    row.values[/晋阶后/.test(key) ? 1 : 0] = value
  }
  return { levels: ['晋阶前', '晋阶后'], rows }
}

function voiceLines(html) {
  const labels = { 中: '中', 汉: '中', 日: '日', 英: '英', 韩: '韩' }
  const found = []
  const seen = new Set()
  for (const line of stripHtml(html).split('\n')) {
    const matched = line.trim().match(/^([中汉日英韩])(?:[文语])?(?:语|配)?\s*(?:CV|cv|配音)?\s*[：:]\s*(.+)$/)
    const label = labels[matched?.[1] || '']
    const actor = matched?.[2]?.trim()
    if (!label || !actor || actor === '暂无' || seen.has(label)) continue
    seen.add(label)
    found.push(`${label}：${actor}`)
  }
  return found
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

function videosFromHtml(html) {
  return [...String(html || '').matchAll(/<a[^>]+href=\"([^\"]*article\/\d+[^\"]*)\"[^>]*>([\s\S]*?)<\/a>/gi)].map(item => ({
    name: textOf(item[2]) || '视频', page: String(item[1] || '').match(/article\/(\d+)/)?.[1] || '',
  })).filter(item => item.page)
}

function wikiValue(value) {
  const text = textOf(value)
  if (!text || /^https?:/i.test(text)) return ''
  return ZZZ_CODES[text.toLowerCase()] || text
}

function baseLines(attr) {
  return Object.entries(attr || {}).slice(0, 8).map(([key, value]) => `${key}：${textOf(value?.value || value)}`).filter(line => !/：$/.test(line))
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

function formatZzz(game, page, hint) {
  const entry = formatWiki(game, page)
  if (entry && hint?.filters) applyFilters(entry, hint.filters)
  return entry
}

registerGame('zzz', formatZzz)
