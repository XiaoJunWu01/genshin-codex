import {
  cardsFromHtml, motionOf, parseItemFilters, parseJson, peopleFromHtml, remember, section, shortName, stillOf, stripHtml, textOf, registerGame,
} from './games.js'

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
          const subs = point.subList || []
          if (!subs.length) {
            const name = textOf(point.name).split('/')[0]
            const scaling = traceScaling(point.tableData)
            return name && scaling ? [{ name, text: '', group, scaling }] : []
          }
          return subs.map((item, index) => {
            const text = stripHtml(item.subDesc || item.desc)
            return {
              name: textOf(item.subTitle) || textOf(point.name).split('/')[0] || group,
              text: [text, ...(item.subTag || []).map(textOf)].filter(Boolean).join('\n'),
              icon: index === 0 ? stillOf(item.image) : '',
              group,
              scaling: index === 0 ? traceScaling(point.tableData, text) : null,
            }
          })
        }).filter(item => item.name && (item.text || item.scaling))
        const skills = cards.filter(card => /普攻|战技|终结技|天赋|秘技|额外能力|欢愉技|忆灵/.test(card.group))
        const rest = cards.filter(card => !skills.includes(card) && card.scaling)
        remember(sections, parts, section(module.name || '角色行迹', [], [...skills, ...rest], 'trace'))
      } else if (component.componentId === 'character_rich') {
        const focus = /星魂/.test(module.name) ? 'eidolon' : /推荐/.test(module.name) ? 'recommend' : /故事|语音|关系/.test(module.name) ? 'story' : ''
        const people = focus === 'recommend' ? peopleFromHtml(data.richText) : []
        const eidolons = focus === 'eidolon' ? richCards(data.richText) : []
        const entryCards = focus === 'recommend' ? recommendationCards(data.richText) : []
        const cards = focus === 'recommend' ? (entryCards.length ? entryCards : people) : (eidolons.length ? eidolons : cardsFromHtml(data.richText))
        const limit = focus === 'eidolon' || focus === 'recommend' ? cards.length : 8
        const empty = focus === 'recommend' && !cards.length ? `暂无${module.name || '推荐'}，可能是图鉴数据暂未收录。` : ''
        remember(sections, parts, cards.length ? section(module.name, [], cards.slice(0, limit), focus) : section(module.name, focus === 'recommend' ? [] : [data.richText], [], focus, [], [], [], empty))
      } else if (component.componentId === 'role_voice') {
        const voices = (data.list || []).map(item => {
          const label = textOf(item.tabName)
          const actor = textOf(item.cvName)
          return label && actor ? `${label}：${actor}` : ''
        }).filter(Boolean)
        remember(sections, parts, section('配音', voices, [], 'voice'))
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
  const overview = [
    ...sections.filter(item => item.focus === 'profile'),
    ...sections.filter(item => item.focus === 'ascension'),
    ...sections.filter(item => item.focus === 'recommend'),
    ...sections.filter(item => item.focus === 'voice'),
  ]
  return {
    id: String(content.id), name: shortName(content.title || info.name) || '未命名词条',
    icon: content.icon || info.icon || '', tags: Object.values(filters).flat(), attrs,
    theme: { element: filters['属性']?.[0] || '', path: filters['命途']?.[0] || '', rarity: filters['星级']?.[0] || '', portrait: portraits[0]?.src || '' },
    sections: overview,
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
        if (data.image && !portraits.some(item => item.art)) portraits.push({ name: '光锥', src: data.image, art: true })
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
    sections: sections.filter(item => item.focus === 'effect' || item.focus === 'ascension' || item.focus === 'set'),
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

function traceScaling(table, description = '') {
  const headers = (table?.headers || []).map(textOf)
  const rows = table?.rows || []
  const marked = [...String(description).matchAll(/【([^】]+)】/g)].map(item => item[1].split('/').map(value => value.trim()))
  const values = marked.filter(row => row.length > 1)
  if (values.length) {
    const count = Math.max(...values.map(row => row.length))
    return {
      levels: Array.from({ length: count }, (_, index) => `LV${index + 1}`),
      rows: values.map((row, index) => ({ name: `数值${index + 1}`, values: row })),
    }
  }
  if (headers.length < 2 || !rows.length) return null
  return {
    levels: rows.map(row => textOf(row?.[0])).filter(Boolean),
    rows: headers.slice(1).map((name, index) => ({
      name: /^数值\d+$/.test(name) ? `数值${index + 1}` : name,
      values: rows.map(row => textOf(row?.[index + 1])),
    })).filter(row => row.values.some(Boolean)),
  }
}

function recommendationCards(html) {
  const source = String(html || '').replace(/\\"/g, '"')
  const cards = []
  const seen = new Set()
  for (const match of source.matchAll(/data-entry-title="([^"]+)"/g)) {
    const name = textOf(match[1])
    if (!name || seen.has(name)) continue
    const start = source.lastIndexOf('<', match.index)
    const nextTitle = source.indexOf('data-entry-title=', match.index + match[0].length)
    const nextName = source.indexOf('data-entry-name=', match.index + match[0].length)
    const endCandidates = [nextTitle, nextName].filter(index => index >= 0)
    const end = endCandidates.length ? Math.min(...endCandidates) : source.length
    const block = source.slice(start < 0 ? match.index : start, end)
    const icon = block.match(/data-entry-icon="([^"]+)"/)?.[1] || block.match(/<img[^>]+src="([^"]+)"/)?.[1] || ''
    seen.add(name)
    cards.push({ name, icon })
  }
  for (const match of source.matchAll(/<a[^>]+href="\/sr\/wiki\/content\/\d+\/detail[^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = textOf(match[1])
    if (!name || seen.has(name) || /推荐|属性|生命|攻击|防御/.test(name)) continue
    const block = source.slice(Math.max(0, match.index - 900), match.index + match[0].length)
    const icon = block.match(/<img[^>]+src="([^"]+)"/i)?.[1] || ''
    seen.add(name)
    cards.push({ name, icon })
  }
  return cards
}

function richCards(html) {
  const source = String(html || '')
  const text = stripHtml(source).replace(/^※[\s\S]*?(?=\s*【\s*[1-6一二三四五六]\s*】)/, '').trim()
  const marks = [...text.matchAll(/【\s*([1-6一二三四五六])\s*】/g)]
  if (marks.length < 2) return []
  const icons = [...source.matchAll(/data-image-url="([^"]+)"|<img[^>]+src="([^"]+)"/g)].map(item => item[1] || item[2])
  const digits = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6' }
  return marks.map((mark, index) => {
    const block = text.slice(mark.index + mark[0].length, marks[index + 1]?.index ?? text.length).trim()
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
    const name = lines[0] || ''
    return {
      name: `${digits[mark[1]] || mark[1]} · ${name}`,
      text: lines.slice(1).join('\n'),
      icon: icons[index] || '',
    }
  }).filter(card => card.name)
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

function ascensionGroups(list) {
  return (list || []).map(level => ({
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

function coneGroups(list) {
  const levels = (list || []).map(level => ({
    rank: Number(String(level.name_ || '').match(/\d+/)?.[0] || 0),
    name: textOf(level.name_),
    materials: (level.material || []).map(item => ({ name: textOf(item.name), icon: item.icon || '', amount: item.num || '' })).filter(item => item.name),
  })).filter(group => group.materials.length)
  const max = Math.max(0, ...levels.map(level => level.rank))
  return (max ? levels.filter(level => level.rank === max) : levels).map(({ name, materials }) => ({ name, materials }))
}

function collectGallery(data, portraits, videos) {
  for (const tab of data.list || []) {
    for (const item of tab.table || []) {
      const name = [textOf(item.name), textOf(item.append)].filter(Boolean).join(' · ')
      const page = articleOf(item.url)
      if (/视频/.test(tab.tabName || '') && page) videos.push({ name: name || '视频', page, cover: item.image || '' })
      else if (item.image && !page && !/光锥/.test(name)) portraits.push({ name: name || textOf(tab.tabName) || '图片', src: item.image })
    }
  }
}

function articleOf(value) {
  return String(value || '').match(/article\/(\d+)/)?.[1] || ''
}

registerGame('sr', formatRpg)
