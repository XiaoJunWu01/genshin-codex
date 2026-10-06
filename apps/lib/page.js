import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import puppeteer from '../../../../lib/puppeteer/puppeteer.js'
import { facesHtml, groupsHtml, markText, themeOf } from './theme.js'

export function boardHtml(cards, { columns = 2, showIcon = true } = {}) {
  const items = cards || []
  if (!items.length) return ''
  return `<div class="board cols-${columns}">${items.map((card, index) => {
    const group = card.group && !/默认标题|暂无/.test(card.group) && card.group !== items[index - 1]?.group
      ? `<div class="group">${escapeHtml(card.group)}</div>` : ''
    const icons = showIcon ? (card.icons?.length ? card.icons : [card.icon]).filter(Boolean) : []
    const icon = icons.length
      ? `<div class="icons">${icons.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('')}</div>` : ''
    const text = card.text ? `<p>${markText(card.text)}</p>` : ''
    const table = scalingHtml(card.scaling)
    return `${group}<article class="${icon ? 'tile' : 'tile plain'}"><div>${icon}<b>${escapeHtml(card.name || '')}</b></div>${text}${table}</article>`
  }).join('')}</div>`
}

export function statsHtml(stats) {
  if (!stats?.rows?.length) return ''
  return `<div class="scale rise"><table><thead><tr><th></th>${stats.levels.map(level => `<th>${escapeHtml(level)}</th>`).join('')}</tr></thead><tbody>${stats.rows.map(row => `<tr><th>${escapeHtml(row.name)}</th>${stats.levels.map((_, index) => `<td>${escapeHtml(row.values?.[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`

}

export function profileHtml(lines) {
  const rows = (lines || []).flatMap(line => {
    const index = String(line).indexOf('：')
    if (index <= 0) return []
    return [`<div><em>${escapeHtml(line.slice(0, index))}</em><b>${escapeHtml(line.slice(index + 1))}</b></div>`]
  })
  if (!rows.length) return ''
  const height = Math.ceil(rows.length / 2)
  return `<div class="profile" style="grid-template-rows:repeat(${height},auto)">${rows.join('')}</div>`
}

export function scalingHtml(scaling) {
  const levels = scaling?.levels || []
  const rows = (scaling?.rows || []).filter(row => (row.values || []).some(Boolean))
  if (levels.length < 2 || !rows.length) return ''
  const head = levels.map(level => `<th>${escapeHtml(level)}</th>`).join('')
  const body = rows.map(row => `<tr><th>${escapeHtml(row.name)}</th>${levels.map((_, index) => `<td>${escapeHtml(row.values?.[index] || '')}</td>`).join('')}</tr>`).join('')
  return `<div class="scale"><table><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}


const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const GAME_CSS = `
.board{display:grid;gap:12px}.board.cols-2{grid-template-columns:1fr 1fr}.board.cols-1{grid-template-columns:1fr}
.group{grid-column:1/-1;margin-top:6px;color:var(--accent);font-size:26px;font-weight:800}
.tile{min-width:0;padding:18px 20px;border-radius:18px;background:var(--soft);border:1px solid rgba(15,23,42,.05)}
.tile>div{display:flex;align-items:center;gap:16px}.tile .icons{display:flex;gap:8px;flex-shrink:0}
.tile img{width:96px;height:96px;object-fit:contain;border-radius:18px;background:#fff}
.tile b{color:var(--accent);font-size:28px;line-height:1.4}
.tile p{margin-top:8px;color:#475569;font-size:24px;line-height:1.65;word-break:break-word}
.tile p b.word{display:inline;font-weight:800}
.tile p b{display:inline;color:var(--accent);font-weight:800}
.tile.plain{grid-column:1/-1}
.board.cols-1 .tile{display:flex;gap:18px;align-items:flex-start}
.board.cols-1 .tile>div{flex-shrink:0}
.board.cols-1 .tile p{margin-top:0}
.tile.plain p{color:#334155;font-size:26px}
.tile p b{color:var(--accent)}
.profile{display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:column;margin-top:4px}
.profile div{display:flex;align-items:baseline;gap:14px;min-width:0;padding:11px 4px;border-bottom:1px solid rgba(15,23,42,.08)}
.profile em{flex:0 0 5.2em;color:#64748b;font-style:normal;font-size:24px;font-weight:700}
.profile b{min-width:0;color:var(--ink);font-size:26px;font-weight:700;line-height:1.4}
.voices{display:flex;flex-wrap:wrap;gap:10px}
.voices span{padding:10px 18px;border-radius:999px;background:var(--soft);color:var(--ink);font-size:24px;font-weight:700}
.scale{margin-top:14px;overflow:hidden;border-radius:14px;background:#fff;border:1px solid rgba(15,23,42,.06)}
.scale table{width:100%;border-collapse:collapse;table-layout:fixed}
.scale th,.scale td{padding:9px 4px;border-bottom:1px solid rgba(15,23,42,.06);text-align:center;font-size:20px;font-weight:700;line-height:1.35;word-break:break-all}
.scale thead th{color:#64748b;background:var(--soft);font-size:18px}
.scale tbody th{width:18%;color:var(--ink);text-align:left;padding-left:12px;font-size:21px}
.scale td{color:var(--accent)}
.scale tr:last-child th,.scale tr:last-child td{border-bottom:0}
.scale.rise{margin-top:10px}.scale.rise tbody th{width:24%}.voices{display:grid;grid-template-columns:1fr 1fr;gap:10px}.voices span{display:flex;align-items:baseline;gap:12px;padding:12px 16px;border-radius:16px;background:#fff;border:1px solid rgba(15,23,42,.06);border-left:5px solid var(--accent)}.voices b{flex:0 0 1.4em;color:var(--accent);font-size:24px}.voices em{color:var(--ink);font-style:normal;font-size:25px;font-weight:700}
.faces{display:flex;flex-wrap:wrap;gap:16px 18px}.faces span{display:flex;flex-direction:column;align-items:center;gap:8px;width:128px;padding:0;border:0;background:transparent}
.faces img{width:108px;height:108px;object-fit:cover;border-radius:24px;background:#fff;border:1px solid rgba(15,23,42,.06)}
.faces b{max-width:128px;color:var(--ink);font-size:22px;line-height:1.3;text-align:center;word-break:break-all}
.hero.art{align-items:flex-end}.hero.art .splash{width:280px;height:360px;object-fit:contain;object-position:center bottom;border-radius:20px;background:transparent}
`


export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function renderHtml(html) {
  const tmpDir = path.join(pluginRoot, 'temp')
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
  const tplFile = path.join(tmpDir, `game_${Date.now()}.html`)
  fs.writeFileSync(tplFile, html)
  try {
    return await puppeteer.screenshot('dps-plugin', { tplFile, imgType: 'png', fullPage: false })
  } finally {
    try { fs.unlinkSync(tplFile) } catch {}
  }
}

export function pageHtml({ title, subtitle, body, footer, theme, extraCss }) {
  const palette = theme || themeOf({})
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}html,body{overflow:hidden}
body{display:inline-block;font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif;background:transparent}
.page{display:inline-block;background:linear-gradient(145deg,${palette.soft} 0%,${palette.color} 140%);padding:18px}
.container{--accent:${palette.color};--soft:${palette.soft};--ink:${palette.ink};width:1080px;padding:28px;background:rgba(255,255,255,.96);border:1px solid rgba(255,255,255,.7);border-radius:28px}
.header{display:${theme ? 'none' : 'block'};margin-bottom:16px;padding:16px 20px;border-radius:18px;background:linear-gradient(135deg,var(--soft),#fff)}
.header h1{font-size:34px;color:var(--ink)}.subtitle{margin-top:6px;color:#64748b;font-size:20px}
.footer{margin-top:16px;padding:12px 16px;border-radius:16px;background:var(--soft);text-align:center;color:#64748b;font-size:18px}
${extraCss || ''}
</style></head><body><div class="page"><div class="container">
<div class="header"><h1>${escapeHtml(title)}</h1><div class="subtitle">${escapeHtml(subtitle || '')}</div></div>
${body}<div class="footer">${footer || ''}</div></div></div>
<script>window.addEventListener('load',()=>{setTimeout(()=>{const page=document.querySelector('.page');if(!page)return;const rect=page.getBoundingClientRect();const w=Math.ceil(rect.width);const h=Math.ceil(rect.height);document.documentElement.style.width=w+'px';document.documentElement.style.height=h+'px';document.body.style.width=w+'px';document.body.style.height=h+'px'},100)})</script>
</body></html>`
}

export function resultHtml(results) {
  return `<div class="results">${results.map((item, index) => {
    const icon = item.icon ? `<img src="${escapeHtml(item.icon)}" alt="">` : '<span class="placeholder"></span>'
    return `<div class="result">${icon}<div><b>${index + 1}. ${escapeHtml(item.name)}</b><span>${escapeHtml(item.channelName || '词条')}</span></div></div>`
  }).join('')}</div>`
}

export function entryHtml(entry, focus, { factsOf, layoutOf, overview, links }) {
  const icon = entry.icon ? `<img class="cover" src="${escapeHtml(entry.icon)}" alt="">` : ''
  const factRows = factsOf(entry) || []
  const facts = factRows.filter(([, value]) => value)
    .map(([label, value]) => `<span><em>${label}</em><b>${escapeHtml(value)}</b></span>`).join('')
  const used = new Set(factRows.map(([, value]) => value))
  const tags = (entry.tags || []).filter(tag => !used.has(tag)).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')
  const source = focus?.id === 'detail'
    ? entry.all || entry.sections || []
    : (focus?.id === 'profile'
      ? [...(entry.parts?.profile || []), ...(entry.parts?.voice || [])]
      : (focus
        ? entry.parts?.[focus.id] || []
        : (entry.sections || []).filter(section => !section.focus || overview.has(section.focus) || section.focus === 'voice' || (section.focus === 'story' && section.title === '角色简介'))))
  const repeated = !focus && source.some(section => section.focus === 'profile')
  const sections = source.map(section => {
    const shown = !focus && section.focus === 'recommend'
      ? { ...section, text: '', lines: [] }
      : (!focus && section.focus === 'ascension'
        ? { ...section, groups: (section.groups || []).filter(group => group.materials?.length).slice(0, 1), text: '' }
        : section)
    const roles = shown.focus === 'recommend' && /角色|配队/.test(shown.title) ? facesHtml(shown.cards, shown.empty || '暂无角色推荐') : ''
    const layout = layoutOf(section) || { columns: /推荐|套装|效果/.test(section.title) ? 2 : 1, showIcon: section.focus !== 'effect' && section.focus !== 'set' }
    const cards = roles ? '' : boardHtml(shown.cards, layout)
    const profile = shown.focus === 'profile' && shown.lines?.length ? profileHtml(shown.lines) : ''
    const voices = shown.focus === 'voice'
      ? `<div class="voices">${(shown.lines || []).map(line => { const cut = String(line).indexOf('：'); const label = cut > 0 ? line.slice(0, cut) : ''; const actor = cut > 0 ? line.slice(cut + 1) : line; return `<span>${label ? `<b>${escapeHtml(label)}</b>` : ''}<em>${escapeHtml(actor)}</em></span>` }).join('')}</div>` : ''
    const prose = profile || voices || roles ? '' : (shown.text && !(repeated && section.focus === 'profile') ? `<p>${markText(shown.text)}</p>` : '')
    const levels = groupsHtml(shown.groups, shown.total, statsHtml)
    return `<section><h3>${escapeHtml(shown.title)}</h3>${prose}${profile}${voices}${levels}${roles}${cards}${shown.empty && !cards && !voices && !roles ? `<p class="empty">${escapeHtml(shown.empty)}</p>` : ''}</section>`
  }).join('')
  const moreLinks = links?.length ? `<div class="more"><em>分开查看</em>${links.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</div>` : ''
  const title = focus && focus.id !== 'detail' ? `${entry.name} · ${focus.name}` : entry.name
  const splash = focus?.id === 'detail' || !entry.theme?.portrait ? '' : `<img class="splash" src="${escapeHtml(entry.theme.portrait)}" alt="">`
  return `<div class="hero${splash ? ' art' : ''}">${splash || icon}<div><h2>${escapeHtml(title)}</h2>${facts ? `<div class="facts">${facts}</div>` : ''}<div class="tags">${tags}</div></div></div>${sections}${moreLinks}`
}
