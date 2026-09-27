import plugin from '../../../lib/plugins/plugin.js'
function clip(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? text.slice(0, limit) + '…' : text
}

function boardHtml(cards, { columns = 2, clamp = 3, showIcon = true } = {}) {
  const items = cards || []
  if (!items.length) return ''
  return `<div class="board cols-${columns}">${items.map((card, index) => {
    const group = card.group && card.group !== items[index - 1]?.group
      ? `<div class="group">${escapeHtml(card.group)}</div>` : ''
    const icons = showIcon ? (card.icons?.length ? card.icons : [card.icon]).filter(Boolean) : []
    const icon = icons.length
      ? `<div class="icons">${icons.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('')}</div>` : ''
    const text = card.text ? `<p>${textBlock(clip(card.text, clamp > 4 ? 180 : 96))}</p>` : ''
    return `${group}<article class="${icon ? 'tile' : 'tile plain'}"><div>${icon}<b>${escapeHtml(card.name || '')}</b></div>${text}</article>`
  }).join('')}</div>`
}

import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  channelOf, channelPattern, focusOf, gameOf,
  getGameEntry, listGame, searchGame,
} from '../model/games.js'
import { entryCss, groupsHtml, resultCss, themeOf } from './wiki.js'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sessions = new Map()
const GAMES = [
  { key: 'sr', letter: 's', words: ['星铁', '星穹铁道', '崩铁'] },
  { key: 'zzz', letter: 'z', words: ['绝区零', '绝区'] },
]
const THEMES = {
  sr: entry => [['属性', entry.theme.element], ['命途', entry.theme.path], ['星级', entry.theme.rarity]],
  zzz: entry => [['属性', entry.theme.element], ['特性', entry.theme.weapon], ['稀有度', entry.theme.rarity], ['阵营', entry.theme.faction]],
}
const LAYOUT = {
  sr: {
    trace: { columns: 1, clamp: 4, showIcon: false },
    eidolon: { columns: 1, clamp: 5, showIcon: false },
    skill: { columns: 1, clamp: 4, showIcon: false },
    effect: { columns: 1, clamp: 8, showIcon: false },
  },
  zzz: {
    skill: { columns: 1, clamp: 3, showIcon: false },
    cinema: { columns: 2, clamp: 3, showIcon: false },
    disk: { columns: 1, clamp: 4, showIcon: false },
    story: { columns: 1, clamp: 6, showIcon: false },
  },
}
const OVERVIEW = {
  sr: new Set(['profile', 'trace', 'eidolon', 'effect', 'set']),
  zzz: new Set(['profile', 'skill', 'cinema']),
}
const GAME_CSS = `
.board{display:grid;gap:8px}.board.cols-2{grid-template-columns:1fr 1fr}.board.cols-1{grid-template-columns:1fr}
.group{grid-column:1/-1;color:var(--accent);font-size:13px;font-weight:800}
.tile{min-width:0;padding:10px 12px;border-radius:12px;background:var(--soft);border:1px solid rgba(15,23,42,.05)}
.tile>div{display:flex;align-items:flex-start;gap:8px}.tile .icons{display:flex;gap:3px;flex-shrink:0}
.tile img{width:36px;height:36px;object-fit:contain;border-radius:8px;background:#fff}
.tile b{color:var(--ink);font-size:14px;line-height:1.4}
.tile p{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;margin-top:4px;color:#475569;font-size:12px;line-height:1.55}
.cols-1 .tile p{-webkit-line-clamp:4}.cols-2 .tile p{-webkit-line-clamp:3}
`

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textBlock(value) {
  return escapeHtml(value).replace(/\n/g, '<br>')
}

function commandOf(text) {
  const source = String(text || '').trim()
  const letter = source.match(/^#?([sz])(?![a-z#])\s*(.*)$/i)
  if (letter) {
    const game = GAMES.find(item => item.letter === letter[1].toLowerCase())
    return { key: game.key, letter: game.letter, rest: letter[2].trim() }
  }
  const word = source.match(/^(?:#|g)?(星铁|星穹铁道|崩铁|绝区零|绝区)\s*(.*)$/)
  if (!word) return null
  const game = GAMES.find(item => item.words.includes(word[1]))
  return { key: game.key, letter: game.letter, rest: word[2].trim() }
}

function mark(game) {
  return game.letter
}

export default class GameWikiPlugin extends plugin {
  constructor() {
    const words = GAMES.flatMap(item => item.words).join('|')
    const letters = GAMES.map(item => item.letter).join('')
    super({
      name: '星铁绝区零图鉴',
      dsc: '崩坏：星穹铁道与绝区零图鉴',
      event: 'message',
      priority: 480,
      rule: [
        { reg: `^#?[${letters}](?![a-z#])(?:\\s*帮助)?$`, fnc: 'help' },
        { reg: `^#?[${letters}](?![a-z#])\\s*\\S+`, fnc: 'query' },
        { reg: `^(?:#|g)?(?:${words})(?:\\s*帮助)?$`, fnc: 'help' },
        { reg: `^(?:#|g)?(?:${words})\\s*\\S+`, fnc: 'query' },
      ],
    })
  }

  sessionKey(e, key) {
    return `${key}:${e.group_id ? 'g' + e.group_id : 'u' + e.user_id}`
  }

  async render(html) {
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

  page({ title, subtitle, body, footer, theme, extraCss }) {
    const palette = theme || themeOf({})
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}html,body{overflow:hidden}
body{display:inline-block;font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif;background:transparent}
.page{display:inline-block;background:linear-gradient(145deg,${palette.soft} 0%,${palette.color} 140%);padding:18px}
.container{--accent:${palette.color};--soft:${palette.soft};--ink:${palette.ink};width:760px;padding:16px;background:rgba(255,255,255,.96);border:1px solid rgba(255,255,255,.7);border-radius:22px}
.header{display:${theme ? 'none' : 'block'};margin-bottom:12px;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,var(--soft),#fff)}
.header h1{font-size:22px;color:var(--ink)}.subtitle{margin-top:3px;color:#64748b;font-size:13px}
.footer{margin-top:12px;padding:8px 12px;border-radius:12px;background:var(--soft);text-align:center;color:#64748b;font-size:12px}
${extraCss || ''}
</style></head><body><div class="page"><div class="container">
<div class="header"><h1>${escapeHtml(title)}</h1><div class="subtitle">${escapeHtml(subtitle || '')}</div></div>
${body}<div class="footer">${footer || ''}</div></div></div>
<script>window.addEventListener('load',()=>{setTimeout(()=>{const page=document.querySelector('.page');if(!page)return;const rect=page.getBoundingClientRect();const w=Math.ceil(rect.width);const h=Math.ceil(rect.height);document.documentElement.style.width=w+'px';document.documentElement.style.height=h+'px';document.body.style.width=w+'px';document.body.style.height=h+'px'},100)})</script>
</body></html>`
  }

  async replyImage(e, html, fallback) {
    try {
      const img = await this.render(html)
      if (img) return e.reply(img)
    } catch (err) {
      logger.error('[星铁绝区零图鉴] 截图失败:', err)
    }
    return e.reply(fallback || '图片渲染失败，请稍后重试')
  }

  entryHtml(key, entry, focus) {
    const theme = themeOf(entry)
    const icon = entry.icon ? `<img class="cover" src="${escapeHtml(entry.icon)}" alt="">` : ''
    const facts = (THEMES[key]?.(entry) || []).filter(([, value]) => value)
      .map(([label, value]) => `<span><em>${label}</em><b>${escapeHtml(value)}</b></span>`).join('')
    const used = new Set((THEMES[key]?.(entry) || []).map(([, value]) => value))
    const tags = (entry.tags || []).filter(tag => !used.has(tag)).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')
    const source = focus
      ? entry.parts?.[focus.id] || []
      : (entry.sections || []).filter(section => !section.focus || OVERVIEW[key]?.has(section.focus))
    const sections = source.map(section => {
      const layout = LAYOUT[key]?.[section.focus] || { columns: 2, clamp: 3, showIcon: true }
      const cards = boardHtml(section.cards, layout)
      return `<section><h3>${escapeHtml(section.title)}</h3>${section.text ? `<p>${textBlock(section.text)}</p>` : ''}${groupsHtml(section.groups)}${cards}</section>`
    }).join('')
    const links = !focus && entry.parts ? Object.keys(entry.parts).map(id => focusOf(key, id)?.name).filter(Boolean) : []
    const more = links.length ? `<div class="more"><em>分开查看</em>${links.map(name => `<span>${mark(gameOf(key))}${escapeHtml(name)} ${escapeHtml(entry.name)}</span>`).join('')}</div>` : ''
    const title = focus ? `${entry.name} · ${focus.name}` : entry.name
    return `<div class="hero">${icon}<div><h2>${escapeHtml(title)}</h2>${facts ? `<div class="facts">${facts}</div>` : ''}<div class="tags">${tags}</div></div></div>${sections}${more}`
  }

  resultHtml(results) {
    return `<div class="results">${results.map((item, index) => {
      const icon = item.icon ? `<img src="${escapeHtml(item.icon)}" alt="">` : '<span class="placeholder"></span>'
      return `<div class="result">${icon}<div><b>${index + 1}. ${escapeHtml(item.name)}</b><span>${escapeHtml(item.channelName || '词条')}</span></div></div>`
    }).join('')}</div>`
  }

  async help(e) {
    const command = commandOf(e.msg)
    if (command.rest && command.rest !== '帮助') return false
    const game = gameOf(command.key)
    const lines = command.key === 'sr'
      ? ['s流萤', 's角色 流萤', 's行迹 流萤', 's星魂 流萤', 's光锥 记一位友人', 's遗器 宝命长存的莳者']
      : ['z妮可', 'z代理人 妮可', 'z技能 妮可', 'z影画 妮可', 'z突破 妮可', 'z音擎 聚宝箱', 'z驱动盘 荆棘玫瑰', 'z邦布 艾米莉安']
    await e.reply([`${game.name}图鉴（${mark(game)} 前缀）`, ...lines].join('\n'))
    return true
  }

  async query(e) {
    const command = commandOf(e.msg)
    const game = gameOf(command.key)
    const rest = command.rest
    if (!rest || rest === '帮助') return this.help(e)
    try {
      if (/^\d+$/.test(rest)) return this.openIndex(e, command.key, parseInt(rest, 10))
      const channel = await channelOf(command.key, rest.split(/\s+/)[0])
      const focus = focusOf(command.key, rest.split(/\s+/)[0])
      const keyword = (channel || focus) ? rest.split(/\s+/).slice(1).join('') : rest.replace(/\s+/g, '')
      if (!keyword) return this.catalog(e, command.key, channel)
      const results = await searchGame(command.key, keyword, { channelId: channel?.id || 0, limit: 8 })
      if (!results.length) {
        await e.reply(`${game.name}没有找到「${keyword}」。`)
        return true
      }
      const exact = results.filter(item => item.score >= 100)
      const chosen = results.length === 1 || exact.length === 1 ? (exact[0] || results[0]) : null
      if (chosen) return this.show(e, command.key, chosen, focus)
      sessions.set(this.sessionKey(e, command.key), { results, focus: focus?.id || '', time: Date.now() })
      const gameInfo = GAMES.find(item => item.key === command.key)
      await this.replyImage(e, this.page({
        title: `「${keyword}」`,
        subtitle: `${game.name}有多个结果`,
        body: this.resultHtml(results),
        footer: `发送 ${gameInfo.letter}1 打开对应条目`,
        extraCss: resultCss,
      }), results.map((item, index) => `${index + 1}. ${item.name}`).join('\n'))
    } catch (err) {
      logger.error(`[${game.name}图鉴]`, err)
      await e.reply(`${game.name}图鉴查询失败，请稍后重试`)
    }
    return true
  }

  async catalog(e, key, channel) {
    const game = gameOf(key)
    if (!channel) {
      await e.reply(`${game.name}分类：${(await channelPattern(key)).split('|').join('、')}`)
      return true
    }
    const result = await listGame(key, channel, 1)
    const body = this.resultHtml(result.items)
    await this.replyImage(e, this.page({
      title: `${game.name} · ${channel.name}`,
      subtitle: `第 1/${result.totalPage} 页 · 共 ${result.total} 条`,
      body,
      footer: `查询：${mark(game)}${channel.name} 名字`,
      extraCss: resultCss,
    }), `${channel.name}共 ${result.total} 条`)
    return true
  }

  async openIndex(e, key, index) {
    const game = gameOf(key)
    const cached = sessions.get(this.sessionKey(e, key))
    const target = cached && Date.now() - cached.time < 10 * 60 * 1000 ? cached.results[index - 1] : null
    if (!target) {
      await e.reply(`没有这条序号。请先搜索，例如 ${mark(game)}名字`)
      return true
    }
    return this.show(e, key, target, focusOf(key, cached.focus))
  }

  async show(e, key, target, focus) {
    const game = gameOf(key)
    const entry = await getGameEntry(key, target.id, target)
    const source = focus ? entry.parts?.[focus.id] || [] : entry.sections || []
    if (focus && !source.length) {
      await e.reply(`「${entry.name}」没有单独的${focus.name}内容。`)
      return true
    }
    const lines = [`${entry.name}${focus ? ' · ' + focus.name : ''}`, (entry.tags || []).join(' · ')]
    for (const section of source.slice(0, 3)) lines.push(section.title)
    await this.replyImage(e, this.page({
      title: entry.name,
      subtitle: target.channelName || game.name,
      body: this.entryHtml(key, entry, focus),
      footer: `数据来源：米游社${game.name}图鉴`,
      theme: themeOf(entry),
      extraCss: entryCss + GAME_CSS,
    }), lines.join('\n'))
    if (!focus && entry.motions?.length) await this.sendMotions(e, entry)
    return true
  }

  async sendMotions(e, entry) {
    const motions = entry.motions.slice(0, 12)
    if (!e.group?.makeForwardMsg) {
      await e.reply([`${entry.name}的动作：`, ...motions.flatMap(item => [item.name || '动作', segment.image(item.src)])])
      return
    }
    const forward = await e.group.makeForwardMsg(motions.map(item => ({
      message: [item.name || '动作', segment.image(item.src)],
      nickname: entry.name,
      user_id: 10000,
    })))
    const icon = entry.icon || ''
    const nodes = Array.isArray(forward?.data) ? forward.data : null
    for (const node of nodes || []) {
      const author = node?.data
      if (author && typeof author === 'object' && ('name' in author || 'uin' in author || 'avatar' in author)) author.avatar = icon
    }
    await e.reply(forward)
  }
}
