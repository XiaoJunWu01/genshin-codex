import plugin from '../../../lib/plugins/plugin.js'
function boardHtml(cards, { columns = 2, showIcon = true } = {}) {
  const items = cards || []
  if (!items.length) return ''
  return `<div class="board cols-${columns}">${items.map((card, index) => {
    const group = card.group && card.group !== items[index - 1]?.group
      ? `<div class="group">${escapeHtml(card.group)}</div>` : ''
    const icons = showIcon ? (card.icons?.length ? card.icons : [card.icon]).filter(Boolean) : []
    const icon = icons.length
      ? `<div class="icons">${icons.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('')}</div>` : ''
    const text = card.text ? `<p>${markText(card.text)}</p>` : ''
    return `${group}<article class="${icon ? 'tile' : 'tile plain'}"><div>${icon}<b>${escapeHtml(card.name || '')}</b></div>${text}</article>`
  }).join('')}</div>`
}

import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  channelOf, channelPattern, focusOf, gameOf,
  getGameEntry, listGame, mediaClip, mediaGroups, mediaImages, mediaOf, mediaVideos, resolveVideo, searchGame,
} from '../model/games.js'
import { clipText } from '../model/wiki.js'
import { entryCss, groupsHtml, markText, resultCss, themeOf } from './wiki.js'

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
    trace: { columns: 1, showIcon: true },
    eidolon: { columns: 2, showIcon: true },
    skill: { columns: 1, showIcon: true },
    effect: { columns: 1, showIcon: false },
  },
  zzz: {
    skill: { columns: 1, showIcon: true },
    cinema: { columns: 2, showIcon: false },
    disk: { columns: 1, showIcon: false },
    story: { columns: 1, showIcon: false },
  },
}
const OVERVIEW = {
  sr: new Set(['profile', 'ascension', 'set']),
  zzz: new Set(['profile', 'ascension']),
}
const GAME_CSS = `
.board{display:grid;gap:8px}.board.cols-2{grid-template-columns:1fr 1fr}.board.cols-1{grid-template-columns:1fr}
.group{grid-column:1/-1;margin-top:4px;color:var(--accent);font-size:17px;font-weight:800}
.tile{min-width:0;padding:14px 16px;border-radius:14px;background:var(--soft);border:1px solid rgba(15,23,42,.05)}
.tile>div{display:flex;align-items:center;gap:10px}.tile .icons{display:flex;gap:4px;flex-shrink:0}
.tile img{width:48px;height:48px;object-fit:contain;border-radius:10px;background:#fff}
.tile b{color:var(--accent);font-size:18px;line-height:1.4}
.tile p{margin-top:6px;color:#475569;font-size:16px;line-height:1.6;word-break:break-word}
.tile p b{color:var(--accent)}
.hero.art{align-items:flex-end}.hero.art .splash{width:180px;height:240px;object-fit:contain;object-position:center bottom;border-radius:16px;background:transparent}
`

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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
        { reg: `^#?[${letters}](?![a-z#])(?:表情包|壁纸|影音|角色视频|其他视频)(?:\\s*\\S.*)?$`, fnc: 'gallery' },
        { reg: `^(?:#|g)?(?:${words})(?:\\s*帮助)?$`, fnc: 'help' },
        { reg: `^(?:#|g)?(?:${words})\\s*\\S+`, fnc: 'query' },
        { reg: `^(?:#|g)?(?:${words})(?:表情包|壁纸|影音|角色视频|其他视频)(?:\\s*\\S.*)?$`, fnc: 'gallery' },
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
    const source = focus?.id === 'detail'
      ? entry.all || entry.sections || []
      : (focus
        ? entry.parts?.[focus.id] || []
        : (entry.sections || []).filter(section => !section.focus || OVERVIEW[key]?.has(section.focus)))
    const sections = source.map(section => {
      const shown = !focus && section.focus === 'profile'
        ? { ...section, text: clipText(section.text || '', 46) }
        : (!focus && section.focus === 'ascension' ? { ...section, groups: [], text: '' } : section)
      const layout = LAYOUT[key]?.[section.focus] || { columns: 2, showIcon: true }
      const cards = boardHtml(shown.cards, layout)
      return `<section><h3>${escapeHtml(shown.title)}</h3>${shown.text ? `<p>${markText(shown.text)}</p>` : ''}${groupsHtml(shown.groups, shown.total)}${cards}</section>`
    }).join('')
    const links = !focus || focus.id === 'detail' ? Object.keys(entry.parts || {}).map(id => focusOf(key, id)?.name).filter(Boolean) : []
    const more = links.length ? `<div class="more"><em>分开查看</em>${links.map(name => `<span>${mark(gameOf(key))}${escapeHtml(name)} ${escapeHtml(entry.name)}</span>`).join('')}</div>` : ''
    const title = focus && focus.id !== 'detail' ? `${entry.name} · ${focus.name}` : entry.name
    const splash = focus?.id === 'detail' || !entry.theme?.portrait ? '' : `<img class="splash" src="${escapeHtml(entry.theme.portrait)}" alt="">`
    return `<div class="hero${splash ? ' art' : ''}">${splash || icon}<div><h2>${escapeHtml(title)}</h2>${facts ? `<div class="facts">${facts}</div>` : ''}<div class="tags">${tags}</div></div></div>${sections}${more}`
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
      ? ['s流萤', 's立绘 流萤', 's行迹 流萤', 's星魂 流萤', 's晋阶 流萤', 's影音 流萤', 's表情包']
      : ['z妮可', 'z立绘 妮可', 'z技能 妮可', 'z影画 妮可', 'z突破 妮可', 'z影音 妮可', 'z壁纸']
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
      const words = rest.split(/\s+/).filter(Boolean)
      const page = /^\d+$/.test(words.at(-1) || '') && words.length > 1 ? parseInt(words.pop(), 10) : 0
      const lead = words[0] || ''
      const channel = words.length > 1 ? await channelOf(command.key, lead) : null
      const focus = words.length > 1 ? focusOf(command.key, lead) : null
      const keyword = (channel || focus) ? words.slice(1).join('') : words.join('')
      if (!keyword) return this.catalog(e, command.key, channel)
      if (page && /影音|视频/.test(rest)) return this.openVideoPage(e, command.key, keyword, page)
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
    if (cached?.videos && Date.now() - cached.time < 10 * 60 * 1000) {
      const item = cached.videos[index - 1]
      if (!item) {
        await e.reply(`没有第 ${index} 条。当前共 ${cached.videos.length} 条。`)
        return true
      }
      return this.playVideo(e, key, item)
    }
    const target = cached && Date.now() - cached.time < 10 * 60 * 1000 ? cached.results[index - 1] : null
    if (!target) {
      await e.reply(`没有这条序号。请先搜索，例如 ${mark(game)}名字`)
      return true
    }
    return this.show(e, key, target, focusOf(key, cached.focus))
  }

  async openVideoPage(e, key, keyword, page) {
    const cached = sessions.get(this.sessionKey(e, key))
    if (cached?.videos && cached.keyword === keyword && Date.now() - cached.time < 10 * 60 * 1000) {
      return this.showVideoPage(e, key, cached.videos, keyword, page)
    }
    const result = await mediaVideos(key, keyword)
    if (!result.items.length) {
      await e.reply(`没有找到「${keyword}」的视频。`)
      return true
    }
    return this.showVideoPage(e, key, result.items, keyword, page)
  }

  async show(e, key, target, focus) {
    const game = gameOf(key)
    const entry = await getGameEntry(key, target.id, target)
    if (focus?.id === 'portrait') return this.sendPortraits(e, entry)
    if (focus?.id === 'video') return this.sendVideos(e, key, entry)
    const source = focus?.id === 'detail' ? entry.sections || [] : (focus ? entry.parts?.[focus.id] || [] : entry.sections || [])
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

  async sendPortraits(e, entry) {
    const pictures = entry.portraits?.length ? entry.portraits : (entry.theme?.portrait ? [{ src: entry.theme.portrait, name: entry.name }] : [])
    if (!pictures.length) {
      await e.reply(`「${entry.name}」还没有立绘。`)
      return true
    }
    await e.reply(pictures.flatMap(item => [item.name && pictures.length > 1 ? item.name : '', segment.image(item.src)].filter(Boolean)))
    return true
  }

  async sendVideos(e, key, entry) {
    const clips = entry.videos || []
    if (!clips.length) {
      await e.reply(`「${entry.name}」没有收录视频。`)
      return true
    }
    const game = gameOf(key)
    const items = clips.map((clip, index) => ({ id: String(index), name: clip.name || '视频', cover: clip.cover || '', summary: '', page: clip.page }))
    return this.showVideoPage(e, key, items, entry.name, 1)
  }

  async gallery(e) {
    const command = commandOf(e.msg)
    const game = gameOf(command.key)
    const spec = mediaOf(command.key)
    const keyword = command.rest.replace(/^(?:表情包|壁纸|影音|角色视频|其他视频)/, '').trim()
    if (spec?.kind === 'wallpaper' && /表情包/.test(command.rest)) {
      await e.reply(`${game.name}没有表情包收录，发送 ${mark(game)}壁纸 查看壁纸。`)
      return true
    }
    if (spec?.kind === 'emoji' && /壁纸/.test(command.rest)) {
      await e.reply(`${game.name}的收录是表情包，发送 ${mark(game)}表情包。`)
      return true
    }
    if (spec?.videos && /^(?:影音|角色视频|其他视频)/.test(command.rest)) return this.showMedia(e, command.key, keyword)
    if (spec?.kind === 'video') return this.showMedia(e, command.key, keyword)
    try {
      const groups = await mediaGroups(command.key)
      const chosen = keyword ? groups.find(item => item.name === keyword) || groups.find(item => item.name.includes(keyword)) : null
      if (!chosen) {
        await e.reply([`${game.name}${spec.name}`, ...groups.slice(0, 20).map(item => `${mark(game)}${spec.name} ${item.name}`)].join('\n'))
        return true
      }
      const images = await mediaImages(command.key, chosen.name)
      if (!images.length) {
        await e.reply(`「${chosen.name}」没有可发送的图片。`)
        return true
      }
      await this.forwardImages(e, chosen.name, images)
    } catch (err) {
      logger.error(`[${game.name}${spec?.name || '图集'}]`, err)
      await e.reply('图片获取失败，请稍后重试')
    }
    return true
  }

  async showMedia(e, key, keyword) {
    const game = gameOf(key)
    const spec = mediaOf(key)
    try {
      if (!keyword) {
        const items = await mediaGroups(key)
        const groups = spec.groups || spec.videos || []
        const lines = groups.map(group => `${mark(game)}${group.name}（${items.filter(item => item.group === group.name).length}）`)
        await e.reply([`${game.name}${spec.name}`, ...lines, `搜索：${mark(game)}影音 名字`].join('\n'))
        return true
      }
      const result = await mediaVideos(key, keyword)
      if (!result.items.length) {
        await e.reply(`${spec.name}没有找到「${keyword}」。`)
        return true
      }
      return this.showVideoPage(e, key, result.items, keyword, 1)
    } catch (err) {
      logger.error(`[${game.name}${spec.name}]`, err)
      await e.reply('视频获取失败，请稍后重试')
      return true
    }
  }

  async showVideoPage(e, key, items, keyword, page) {
    const size = 4
    const totalPage = Math.max(1, Math.ceil(items.length / size))
    const current = Math.min(Math.max(page, 1), totalPage)
    sessions.set(this.sessionKey(e, key), { videos: items, keyword, page: current, time: Date.now() })
    const game = gameOf(key)
    const start = (current - 1) * size
    const cards = items.slice(start, start + size).map((item, index) => ({
      name: `${start + index + 1}. ${item.name}`,
      text: item.summary || item.group || '',
      icons: item.cover ? [item.cover] : [],
    }))
    const next = current < totalPage ? `<br>下一页：${mark(game)}影音 ${keyword} ${current + 1}` : ''
    await this.replyImage(e, this.page({
      title: `「${keyword}」的视频`,
      subtitle: `${game.name} · 第 ${current}/${totalPage} 页 · 共 ${items.length} 条`,
      body: boardHtml(cards, { columns: 1 }),
      footer: `发送 ${mark(game)}${start + 1} 播放这一条${next}`,
    }), items.slice(start, start + size).map((item, index) => `${start + index + 1}. ${item.name}`).join('\n'))
    return true
  }

  async playVideo(e, key, item) {
    try {
      const src = item.page ? await resolveVideo(key, item.page) : (await mediaClip(key, item.id))?.src
      if (!src) {
        await e.reply(`「${item.name}」暂时无法播放。`)
        return true
      }
      await e.reply([item.name, segment.video(src)])
    } catch (err) {
      logger.error('[图鉴视频]', err)
      await e.reply('视频获取失败，请稍后重试')
    }
    return true
  }

  async forwardImages(e, name, images) {
    const shown = images.slice(0, 30)
    if (!e.group?.makeForwardMsg) {
      await e.reply([name, ...shown.map(src => segment.image(src))])
      return
    }
    await e.reply(await e.group.makeForwardMsg(shown.map(src => ({ message: segment.image(src), nickname: name, user_id: 10000 }))))
  }
}
