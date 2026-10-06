export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const KEYWORDS = ['风属性','火属性','冰属性','电属性','物理属性','以太属性','风','火','水','雷','冰','岩','草','物理','以太','电','烈霜','单手剑','双手剑','长柄武器','法器','弓','攻击力','生命值','防御力','元素精通','元素充能效率','暴击率','暴击伤害','元素伤害','物理伤害','治疗加成','护盾强效','异常精通','冲击力','穿透率','异常掌控','能量自动回复']
  .sort((a, b) => b.length - a.length)

export function markText(value) {
  const pattern = new RegExp(`(${KEYWORDS.join('|')}|\\d+(?:\\.\\d+)?%?)`, 'g')
  return escapeHtml(value).replace(/\n/g, '<br>').replace(pattern, match => /^\d/.test(match) ? `<b>${match}</b>` : `<b class="word">${match}</b>`)
}

export function placeholderGroup(value) {
  return value && !/默认标题|暂无/.test(value) ? value : ''
}

export function profileGrid(text) {
  const rows = String(text || '').split('\n').map(line => {
    const index = line.indexOf('：')
    if (index <= 0) return ''
    return `<div><em>${escapeHtml(line.slice(0, index))}</em><b>${escapeHtml(line.slice(index + 1))}</b></div>`
  }).filter(Boolean)
  if (!rows.length) return ''
  const height = Math.ceil(rows.length / 2)
  return `<div class="profile" style="grid-template-rows:repeat(${height},auto)">${rows.join('')}</div>`
}

export function scalingHtml(scaling) {
  const levels = scaling?.levels || []
  const rows = scaling?.rows || []
  if (!levels.length || !rows.length) return ''
  if (levels.length > 6) {
    const lines = rows.map(row => `<div><em>${escapeHtml(row.name)}</em><b>${levels.map((level, index) => `${escapeHtml(level)} ${escapeHtml(row.values?.[index] || '')}`).join('<i></i>')}</b></div>`).join('')
    return `<div class="meters">${lines}</div>`
  }
  const head = levels.map(level => `<th>${escapeHtml(level)}</th>`).join('')
  const body = rows.map(row => {
    const cells = levels.map((_, index) => `<td>${escapeHtml(row.values?.[index] || '')}</td>`).join('')
    return `<tr><th>${escapeHtml(row.name)}</th>${cells}</tr>`
  }).join('')
  return `<div class="scale"><table><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

export function talentTotal(groups) {
  const order = []
  const merged = new Map()
  for (const group of groups || []) {
    for (const item of group.materials || []) {
      const amount = Number(item.amount) || 0
      const found = merged.get(item.name)
      if (found) found.amount = String((Number(found.amount) || 0) + amount)
      else {
        const copy = { ...item, amount: amount ? String(amount) : '' }
        merged.set(item.name, copy)
        order.push(copy)
      }
    }
  }
  return order
}

export function roleFaces(cards) {
  const items = []
  const seen = new Set()
  for (const card of cards || []) {
    const icons = (card.icons?.length ? card.icons : [card.icon]).filter(Boolean)
    const names = String(card.name || '').split(/\s*[+/／]\s*/).map(name => name.trim()).filter(Boolean)
    if (icons.length > 1 && names.length === icons.length) {
      icons.forEach((icon, index) => items.push({ name: names[index], icon }))
    } else if (icons.length <= 1) {
      items.push({ name: names[0] || card.name || '', icon: icons[0] || '' })
    } else {
      icons.forEach(icon => items.push({ name: names[0] || card.name || '', icon }))
    }
  }
  return items.filter(item => {
    if (!item.icon || !item.name || /暂无|默认标题/.test(item.name) || seen.has(item.name)) return false
    seen.add(item.name)
    return true
  })
}

export function facesHtml(cards, empty = '暂无角色推荐') {
  const items = roleFaces(cards)
  if (!items.length) return `<p class="empty">${escapeHtml(empty)}</p>`
  return `<div class="faces">${items.map(item => `<span><img src="${escapeHtml(item.icon)}" alt=""><b>${escapeHtml(item.name)}</b></span>`).join('')}</div>`
}

export function cardsHtml(cards, layout = '') {
  const items = cards || []
  if (!items.length) return ''
  const stacked = layout === 'stack'
  const effects = !stacked && items.every(card => !card.icon && !card.icons?.length)
  return `<div class="${stacked ? 'skills' : (effects ? 'effects' : 'equips')}">${items.map((card, index) => {
    const group = placeholderGroup(card.group) && placeholderGroup(card.group) !== placeholderGroup(items[index - 1]?.group)
      ? `<div class="group">${escapeHtml(card.group)}</div>`
      : ''
    const icons = (card.icons?.length ? card.icons : [card.icon]).filter(Boolean)
    const icon = icons.length
      ? `<div class="icons">${icons.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('')}</div>`
      : (effects || stacked ? '' : '<span class="placeholder"></span>')
    const text = card.text ? (stacked ? skillText(card.text) : `<p>${markText(card.text)}</p>`) : ''
    const table = stacked ? scalingHtml(card.scaling) : ''
    return `${group}<div class="${stacked ? 'skill' : 'equip'}">${icon}<div><b>${escapeHtml(card.name || '')}</b>${text}${table}</div></div>`
  }).join('')}</div>`
}

function skillText(value) {
  const parts = String(value).split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
  const quotes = []
  const body = []
  for (const part of parts) {
    const lines = part.split('\n')
    if (lines.every(line => /^[「“][^」”]{8,}[」”]$/.test(line.trim()))) quotes.push(...lines)
    else body.push(part)
  }
  const blocks = body.map(part => `<p>${markText(part)}</p>`).join('')
  const cited = quotes.length ? `<blockquote>${quotes.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</blockquote>` : ''
  return blocks + cited
}

const ELEMENT_THEMES = {
  风: ['#378383', '#e7f6f4', '#123734'],
  火: ['#B8584B', '#fff1ec', '#4a201b'],
  水: ['#518ABB', '#eef6ff', '#17324d'],
  雷: ['#6455A6', '#f4f1ff', '#2c244d'],
  冰: ['#5FACC1', '#eefbff', '#173d48'],
  岩: ['#C09257', '#fff7ec', '#463318'],
  草: ['#6D9840', '#f4faec', '#243814'],
  风属性: ['#378383', '#e7f6f4', '#123734'],
  火属性: ['#B8584B', '#fff1ec', '#4a201b'],
  冰属性: ['#5FACC1', '#eefbff', '#173d48'],
  电属性: ['#6455A6', '#f4f1ff', '#2c244d'],
  物理属性: ['#C09257', '#fff7ec', '#463318'],
  以太属性: ['#8A4FA3', '#f8f1fb', '#3a2044'],
  物理: ['#C09257', '#fff7ec', '#463318'],
  以太: ['#8A4FA3', '#f8f1fb', '#3a2044'],
  电: ['#6455A6', '#f4f1ff', '#2c244d'],
  烈霜: ['#5FACC1', '#eefbff', '#173d48'],
}

export function themeOf(entry) {
  const theme = entry?.theme || {}
  const preset = ELEMENT_THEMES[theme.element] || ['#456990', '#f4f7fb', '#1e293b']
  return {
    element: theme.element || '',
    path: theme.path || '',
    weapon: theme.weapon || '',
    rarity: theme.rarity || '',
    faction: theme.faction || '',
    portrait: theme.portrait || '',
    color: theme.color || preset[0],
    soft: preset[1],
    ink: preset[2],
  }
}

function materialHtml(item) {
  const icon = item.icon ? `<img src="${escapeHtml(item.icon)}" alt="">` : ''
  const amount = item.amount ? `<b>×${escapeHtml(item.amount)}</b>` : ''
  return `<span class="mat">${icon}<em>${escapeHtml(item.name)}</em>${amount}</span>`
}

export function imagesHtml(images, motion = false) {
  const items = images || []
  if (!items.length) return ''
  const shots = items.map(item => {
    const label = item.name ? `<b>${escapeHtml(item.name)}</b>` : ''
    return `<div class="shot"><img src="${escapeHtml(item.src)}" alt="">${label}</div>`
  }).join('')
  return `<div class="${motion ? 'motions' : 'gallery'}">${shots}</div>`
}

export function groupsHtml(groups, total = [], statsHtml = null) {
  const rows = (groups || []).map(group => {
    const items = (group.materials || []).map(materialHtml).join('')
    const note = group.note ? `<small>${markText(group.note)}</small>` : ''
    const stats = statsHtml ? statsHtml(group.stats) : ''
    return `<div class="level"><b>${escapeHtml(group.name)}</b><div>${items}</div>${note}${stats}</div>`
  }).join('')
  const summary = total?.length
    ? `<div class="level total"><b>满级合计</b><div>${total.map(materialHtml).join('')}</div></div>`
    : ''
  return rows || summary ? `<div class="levels">${rows}${summary}</div>` : ''
}

export const resultCss = '.results{display:flex;flex-direction:column;gap:14px}.result{display:flex;align-items:center;gap:18px;padding:18px;background:#fff;border:1px solid rgba(15,23,42,.07);border-radius:18px;border-left:6px solid var(--accent)}.result img,.placeholder{width:96px;height:96px;border-radius:20px;object-fit:cover;background:#f1f5f9;flex-shrink:0}.result b{display:block;color:#1e293b;font-size:30px}.result span{display:inline-block;margin-top:6px;padding:4px 14px;border-radius:999px;background:var(--soft);color:var(--accent);font-size:22px;font-weight:700}.result em{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:6px;color:#64748b;font-style:normal;font-size:22px;line-height:1.5}'

export const entryCss = `
.hero{display:flex;gap:24px;align-items:center;padding:24px;border:1px solid rgba(15,23,42,.08);border-radius:24px;background:linear-gradient(135deg,#fff,var(--soft))}
.cover{width:168px;height:168px;object-fit:contain;border-radius:32px;background:radial-gradient(circle at 50% 42%,#fff,var(--soft) 72%);border:1px solid rgba(15,23,42,.06);flex-shrink:0}
.hero h2{color:var(--ink);font-size:52px;line-height:1.15}
.facts{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}
.facts span{min-width:120px;padding:12px 18px;border-radius:16px;background:#fff;border:1px solid rgba(15,23,42,.06);border-top:5px solid var(--accent)}
.facts em{display:block;color:#64748b;font-style:normal;font-size:20px}
.facts b{color:var(--accent);font-size:30px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tags span{padding:6px 16px;border-radius:999px;background:var(--accent);color:#fff;font-size:22px;font-weight:700}
.profile{display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:column;grid-template-rows:repeat(3,auto);margin-top:4px}
.profile div{display:flex;align-items:baseline;gap:14px;min-width:0;padding:11px 4px;border-bottom:1px solid rgba(15,23,42,.08)}
.profile em{flex:0 0 5.2em;color:#64748b;font-style:normal;font-size:24px;font-weight:700}
.profile b{min-width:0;color:var(--ink);font-size:26px;font-weight:700;line-height:1.4}
.attrs{display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:column;grid-template-rows:repeat(3,auto);gap:12px;margin-top:14px}
.attrs div{padding:16px 20px;background:#fff;border:1px solid rgba(15,23,42,.07);border-radius:18px;border-left:6px solid var(--accent)}
.attrs em{display:block;color:#64748b;font-style:normal;font-size:22px;font-weight:700}
.attrs b{display:block;margin-top:4px;color:var(--ink);font-size:28px;line-height:1.4}
.voices{display:flex;flex-wrap:wrap;gap:10px}
.voices span{padding:10px 18px;border-radius:999px;background:var(--soft);color:var(--ink);font-size:24px;font-weight:700}
section{margin-top:14px;padding:20px;border:1px solid rgba(15,23,42,.08);border-radius:20px;background:#fff}
section h3{display:flex;align-items:center;gap:10px;margin-bottom:16px;color:var(--ink);font-size:32px}
section h3::before{content:\"\";width:6px;height:22px;border-radius:6px;background:var(--accent)}
section p{color:#334155;font-size:26px;line-height:1.7;word-break:break-word}
section p b{color:var(--accent);font-weight:800}
section p b.word{font-weight:800}
.effects .equip p b,.tile p b,.equip p b,.level small b{display:inline;font-weight:800}
.levels{display:flex;flex-direction:column;gap:6px}
.level{padding:8px;border-radius:10px;background:var(--soft)}
.level>b{display:block;margin-bottom:12px;color:var(--accent);font-size:26px}
.level>div{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mat{display:flex;align-items:center;gap:10px;min-width:0;padding:8px 14px 8px 8px;border-radius:16px;background:#fff;border:1px solid rgba(15,23,42,.06)}
.mat img{width:72px;height:72px;object-fit:contain;border-radius:14px;background:var(--soft);flex-shrink:0}
.mat em{color:var(--ink);font-style:normal;font-size:24px;font-weight:700;line-height:1.3}
.mat b{color:var(--accent);font-size:24px;flex-shrink:0}
.level small{display:block;margin-top:8px;color:#475569;font-size:22px;line-height:1.55}
.level small b{color:var(--accent)}
.empty{color:#64748b}
.total{background:#fff;border:1px dashed var(--accent)}
.effects{display:flex;flex-direction:column;gap:12px}
.effects .equip{display:block;min-height:0;padding:18px 20px}
.effects .equip b{font-size:28px}
.effects .equip p{margin-top:8px;color:#334155;font-size:26px;line-height:1.7}
.equips{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.skills{display:flex;flex-direction:column;gap:14px}
.skill{display:flex;gap:18px;align-items:flex-start;padding:22px;border-radius:22px;background:var(--soft);border:1px solid rgba(15,23,42,.05)}
.skill .icons{flex-shrink:0}
.skill .icons img{width:108px;height:108px;object-fit:contain;border-radius:54px;background:#fff;border:1px solid rgba(15,23,42,.06)}
.skill b{display:block;color:var(--ink);font-size:32px;line-height:1.35}
.skill p{margin-top:10px;color:#334155;font-size:26px;line-height:1.75}
.skill p b{display:inline;color:var(--accent);font-size:26px;font-weight:800}
.skill blockquote{margin-top:14px;padding:12px 16px;border-left:5px solid var(--accent);border-radius:0 14px 14px 0;background:#fff}
.skill blockquote p{margin-top:6px;color:#64748b;font-size:23px;line-height:1.7}
.scale{margin-top:14px;overflow:hidden;border-radius:14px;background:#fff;border:1px solid rgba(15,23,42,.06)}
.scale table{width:100%;border-collapse:collapse;table-layout:fixed}
.scale th,.scale td{padding:9px 4px;border-bottom:1px solid rgba(15,23,42,.06);text-align:center;font-size:20px;font-weight:700;line-height:1.35;word-break:break-all}
.scale thead th{color:#64748b;background:var(--soft);font-size:18px}
.scale tbody th{width:18%;color:var(--ink);text-align:left;padding-left:12px;font-size:21px}
.scale td{color:var(--accent)}
.scale tr:last-child th,.scale tr:last-child td{border-bottom:0}
.meters{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.meters div{display:grid;grid-template-columns:220px 1fr;gap:14px;align-items:start;padding:12px 14px;border-radius:14px;background:#fff;border:1px solid rgba(15,23,42,.06)}
.meters em{color:var(--ink);font-style:normal;font-size:22px;font-weight:800;line-height:1.45}
.meters b{display:flex;flex-wrap:wrap;gap:6px 0;color:var(--accent);font-size:21px;line-height:1.45}
.meters i{width:14px}
.faces{display:flex;flex-wrap:wrap;gap:16px 18px}
.faces span{display:flex;flex-direction:column;align-items:center;gap:8px;width:128px}
.faces img{width:108px;height:108px;object-fit:cover;border-radius:24px;background:#fff;border:1px solid rgba(15,23,42,.06)}
.faces b{max-width:128px;color:var(--ink);font-size:22px;line-height:1.3;text-align:center;word-break:break-all}
.group{grid-column:1/-1;margin-top:4px;color:var(--accent);font-size:26px;font-weight:800}
.equip{display:flex;align-items:center;gap:16px;min-height:96px;padding:16px;border-radius:18px;background:var(--soft);border:1px solid rgba(15,23,42,.05)}
.equip .icons{display:flex;gap:8px;flex-shrink:0}
.equip .icons img,.equip>img,.equip>.placeholder{width:96px;height:96px;object-fit:contain;border-radius:18px;background:#fff}
.equip b{display:block;color:var(--accent);font-size:28px;line-height:1.35}
.equip p{margin-top:6px;color:#475569;font-size:24px;line-height:1.5}
.more{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:16px;padding:16px;border-radius:16px;background:var(--soft)}
.more em{color:#64748b;font-style:normal;font-size:22px}
.more span{padding:8px 16px;border-radius:999px;background:#fff;border:1px solid rgba(15,23,42,.08);color:var(--accent);font-size:22px;font-weight:700}
.gallery{display:flex;flex-direction:column;gap:10px}
.shot{padding:8px;border-radius:12px;background:var(--soft);border:1px solid rgba(15,23,42,.05)}
.shot img{display:block;width:100%;max-height:760px;object-fit:contain;border-radius:10px;background:#fff}
.shot b{display:block;margin-top:8px;color:var(--ink);font-size:24px;text-align:center}
.motions{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.motions .shot img{max-height:420px}
`
