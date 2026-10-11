import plugin from '../../../../lib/plugins/plugin.js'
import {
  ENTRY_CHANNEL, channelOf, channelPattern, gameOf, getGameEntry, listGame,
  mediaClip, mediaGroups, mediaImages, mediaOf, mediaVideos, resolveVideo, searchGame,
} from '../../model/games.js'
import { aliasKinds, aliasNames, upcomingName } from '../../model/alias.js'
import { entryCss, resultCss, themeOf } from './theme.js'
import { GAME_CSS, boardHtml, entryHtml, pageHtml, renderHtml, resultHtml } from './page.js'

const sessions = new Map()

export function gamePlugin(spec) {
  const wordPattern = spec.words.join('|')
  const mark = spec.mark || '#'
  const marks = [spec.letter, mark].filter((item, index, list) => list.indexOf(item) === index).join('')
  return class extends plugin {
    constructor() {
      super({
        name: spec.name, dsc: spec.dsc, event: 'message', priority: 5,
        rule: [
          { reg: `^[${marks}](?:影音|pv|PV)(?:\\s*\\S.*)?$`, fnc: 'gallery', priority: 1 },
          { reg: `^[${marks}](?:表情包|壁纸|角色视频|其他视频)(?:\\s*\\S.*)?$`, fnc: 'gallery', priority: 1 },
          { reg: `^(?:${wordPattern})(?:影音|pv|PV)(?:\\s*\\S.*)?$`, fnc: 'gallery', priority: 1 },
          { reg: `^(?:${wordPattern})(?:表情包|壁纸|角色视频|其他视频)(?:\\s*\\S.*)?$`, fnc: 'gallery', priority: 1 },
          { reg: `^\\${mark}[^\\s${mark}]{2,24}$`, fnc: 'queryBare', priority: 1 },
          { reg: `^[${marks}](?:\\s*帮助)?$`, fnc: 'help', priority: 2 },
          { reg: `^[${marks}]\\s*(?:\\d+|\\S{2,})`, fnc: 'query', priority: 2 },
          { reg: `^(?:${wordPattern})(?:\\s*帮助)?$`, fnc: 'help', priority: 2 },
          { reg: `^(?:${wordPattern})\\s*(?:\\d+|\\S{2,})`, fnc: 'query', priority: 2 },
        ],
      })
      this.spec = spec
      this.sessions = sessions
    }

    commandOf(text) {
      const source = String(text || '').trim()
      const mark = this.spec.mark || '#'
      const lettered = source.match(new RegExp(`^[${this.spec.letter}${mark}](?![a-z#])\\s*(.*)$`, 'i'))
      if (lettered) return { rest: lettered[1].trim() }
      const word = source.match(new RegExp(`^(?:${this.spec.words.join('|')})\\s*(.*)$`))
      return word ? { rest: word[1].trim() } : null
    }

    focusOf(keyword) {
      const text = String(keyword || '').trim()
      return this.spec.focus.find(item => item.id === text || item.aliases.includes(text)) || null
    }

    sessionKey(e) {
      return `${this.spec.key}:${e.group_id ? 'g' + e.group_id : 'u' + e.user_id}`
    }

    async replyImage(e, html, fallback) {
      try {
        const img = await renderHtml(html)
        if (img) return e.reply(img)
      } catch (err) {
        logger.error(`[${this.spec.name}] 截图失败:`, err)
      }
      return e.reply(fallback || '图片渲染失败，请稍后重试')
    }

    async queryBare(e) {
      const keyword = String(e.msg || '').replace(/^[^\s]/, '').trim()
      const names = aliasNames(this.spec.key, keyword)
      if (!names.length) return false
      e.msg = `${this.spec.letter}${/专武/.test(keyword) ? keyword : names[0]}`
      return this.query(e)
    }

    async help(e) {
      const command = this.commandOf(e.msg)
      if (!command || (command.rest && command.rest !== '帮助')) return false
      const game = gameOf(this.spec.key)
      const lines = e.isMaster ? this.spec.help : (this.spec.common || this.spec.help.slice(0, 4))
      await e.reply([`${game.name}图鉴（${this.spec.letter} 前缀）`, ...lines].join('\n'))
      return true
    }

    async query(e) {
      const command = this.commandOf(e.msg)
      if (!command) return false
      const game = gameOf(this.spec.key)
      const rest = command.rest
      if (!rest || rest === '帮助') return this.help(e)
      try {
        if (/^\d+$/.test(rest)) return this.openIndex(e, parseInt(rest, 10))
        const words = rest.split(/\s+/).filter(Boolean)
        const page = /^\d+$/.test(words.at(-1) || '') && words.length > 1 ? parseInt(words.pop(), 10) : 0
        const lead = words[0] || ''
        const channel = words.length > 1 ? await channelOf(this.spec.key, lead) : null
        const focus = words.length > 1 ? this.focusOf(lead) : null
        let keyword = (channel || focus) ? words.slice(1).join('') : words.join('')
        const kinds = aliasKinds(this.spec.key, keyword)
        const official = aliasNames(this.spec.key, keyword)[0] || ''
        if (!channel && !focus && /专武|专属音擎|专属光锥/.test(keyword)) {
          const weaponChannel = (await channelsOf(this.spec.key)).find(item => /音擎|光锥|武器/.test(item.name))
          if (!kinds.includes('weapon') || !weaponChannel || !official) {
            await e.reply(`「${keyword.replace(/专武|专属音擎|专属光锥/g, '')}」暂无专属${weaponChannel?.name || '武器'}，可以查看 ${this.spec.letter}推荐 ${keyword.replace(/专武|专属音擎|专属光锥/g, '')}`)
            return true
          }
          return this.openResults(e, await searchGame(this.spec.key, official, { channelId: weaponChannel.id, limit: 8 }), official, weaponChannel, null)
        }
        if (!channel && !focus && official && kinds.length === 1) keyword = official
        if (!keyword) return this.catalog(e, channel)
        if (page && /影音|视频|pv|PV/.test(rest)) return this.openVideoPage(e, keyword, page)
        const results = await searchGame(this.spec.key, keyword, { channelId: channel?.id || 0, limit: 8 })
        return this.openResults(e, results, keyword, channel, focus)
      } catch (err) {
        logger.error(`[${game.name}图鉴]`, err)
        await e.reply('图鉴查询失败：' + (err.message || '请稍后重试'))
      }
      return true
    }

    async openResults(e, results, keyword, channel, focus) {
      const game = gameOf(this.spec.key)
      try {
        const exact = results.filter(item => item.score >= 100)
        const matched = channel || focus ? results : (exact.length ? exact : results)
        if (!matched.length) {
          const upcoming = !channel && !focus ? upcomingName(this.spec.key === 'sr' ? 'sr' : 'zzz', keyword) : ''
          if (upcoming) await e.reply(`暂无「${upcoming}」的角色数据，敬请期待。`)
          return true
        }
        const preferred = !channel && !focus ? exact.filter(item => ENTRY_CHANNEL.test(item.channelName || '')) : []
        const direct = preferred.length === 1 ? preferred[0] : (!channel && !focus && exact.length === 1 ? exact[0] : null)
        const shown = direct ? [direct] : matched
        this.sessions.set(this.sessionKey(e), { results: shown, focus: focus?.id || '', time: Date.now() })
        if (direct || new Set(shown.map(item => item.name)).size === 1) return this.show(e, shown[0], focus)
        await this.replyImage(e, pageHtml({
          title: `「${keyword}」`, subtitle: `${game.name}有多个结果`, body: resultHtml(shown),
          footer: `发送 ${this.spec.letter}1 打开对应条目`, extraCss: resultCss,
        }), matched.map((item, index) => `${index + 1}. ${item.name}`).join('\n'))
      } catch (err) {
        logger.error(`[${game.name}图鉴]`, err)
        await e.reply(`${game.name}图鉴查询失败，请稍后重试`)
      }
      return true
    }

    async catalog(e, channel) {
      const game = gameOf(this.spec.key)
      if (!channel) {
        await e.reply(`${game.name}分类：${(await channelPattern(this.spec.key)).split('|').join('、')}`)
        return true
      }
      const result = await listGame(this.spec.key, channel, 1)
      await this.replyImage(e, pageHtml({
        title: `${game.name} · ${channel.name}`,
        subtitle: `第 1/${result.totalPage} 页 · 共 ${result.total} 条`,
        body: resultHtml(result.items),
        footer: `查询：${this.spec.letter}${channel.name} 名字`,
        extraCss: resultCss,
      }), `${channel.name}共 ${result.total} 条`)
      return true
    }

    async openIndex(e, index) {
      const cached = this.sessions.get(this.sessionKey(e))
      if (cached?.kind === 'video' && cached.videos && Date.now() - cached.time < 10 * 60 * 1000) {
        const item = cached.videos[index - 1]
        if (!item) {
          await e.reply(`没有第 ${index} 条。当前共 ${cached.videos.length} 条。`)
          return true
        }
        return this.playVideo(e, item)
      }
      const target = cached && Date.now() - cached.time < 10 * 60 * 1000 ? cached.results[index - 1] : null
      if (!target) {
        await e.reply(`没有这条序号。请先搜索，例如 ${this.spec.letter}名字`)
        return true
      }
      return this.show(e, target, this.focusOf(cached.focus))
    }

    async openVideoPage(e, keyword, page) {
      const cached = this.sessions.get(this.sessionKey(e))
      if (cached?.kind === 'video' && cached.videos && cached.keyword === keyword && Date.now() - cached.time < 10 * 60 * 1000) {
        return this.showVideoPage(e, cached.videos, keyword, page)
      }
      const result = await mediaVideos(this.spec.key, keyword)
      if (!result.items.length) {
        await e.reply(`没有找到「${keyword}」的视频。`)
        return true
      }
      return this.showVideoPage(e, result.items, keyword, page)
    }

    async show(e, target, focus) {
      const game = gameOf(this.spec.key)
      const entry = await getGameEntry(this.spec.key, target.id, target)
      if (focus?.id === 'portrait') return this.sendPortraits(e, entry)
      if (focus?.id === 'video') return this.sendVideos(e, entry)
      const source = focus?.id === 'detail' ? entry.sections || [] : (focus ? entry.parts?.[focus.id] || [] : entry.sections || [])
      if (focus && !source.length) {
        await e.reply(`「${entry.name}」没有单独的${focus.name}内容。`)
        return true
      }
      const links = !focus || focus.id === 'detail'
        ? Object.keys(entry.parts || {}).filter(id => id !== 'detail').map(id => this.focusOf(id)?.name).filter(Boolean).map(label => `${this.spec.letter}${label} ${entry.name}`)
        : []
      const lines = [`${entry.name}${focus ? ' · ' + focus.name : ''}`, (entry.tags || []).join(' · ')]
      for (const section of source.slice(0, 3)) lines.push(section.title)
      await this.replyImage(e, pageHtml({
        title: entry.name,
        subtitle: target.channelName || game.name,
        body: entryHtml(entry, focus, { factsOf: this.spec.facts, layoutOf: section => this.spec.layout[section.focus], overview: this.spec.overview, links }),
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
      const forward = await e.group.makeForwardMsg(motions.map(item => ({ message: [item.name || '动作', segment.image(item.src)], nickname: entry.name, user_id: 10000 })))
      const icon = entry.icon || ''
      const nodes = Array.isArray(forward?.data) ? forward.data : null
      for (const node of nodes || []) {
        const author = node?.data
        if (author && typeof author === 'object' && ('name' in author || 'uin' in author || 'avatar' in author)) author.avatar = icon
      }
      await e.reply(forward)
    }

    async sendPortraits(e, entry) {
      const pictures = (entry.portraits || []).filter(item => item.art)
      const shown = pictures.length ? pictures : (entry.portraits?.length ? entry.portraits : (entry.theme?.portrait ? [{ src: entry.theme.portrait, name: entry.name }] : []))
      if (!shown.length) {
        await e.reply(`「${entry.name}」还没有立绘。`)
        return true
      }
      await e.reply(shown.flatMap(item => [item.name && shown.length > 1 ? item.name : '', segment.image(item.src)].filter(Boolean)))
      return true
    }

    async sendVideos(e, entry) {
      const clips = entry.videos || []
      if (!clips.length) {
        await e.reply(`「${entry.name}」没有收录视频。`)
        return true
      }
      const items = clips.map((clip, index) => ({ id: String(index), name: clip.name || '视频', cover: clip.cover || '', summary: '', page: clip.page }))
      return this.showVideoPage(e, items, entry.name, 1)
    }

    async gallery(e) {
      const command = this.commandOf(e.msg)
      if (!command) return false
      const game = gameOf(this.spec.key)
      const spec = mediaOf(this.spec.key)
      const keyword = command.rest.replace(/^(?:表情包|壁纸|影音|pv|PV|角色视频|其他视频)/, '').trim()
      if (spec?.kind === 'wallpaper' && /表情包/.test(command.rest)) {
        await e.reply(`${game.name}没有表情包收录，发送 ${this.spec.letter}壁纸 查看壁纸。`)
        return true
      }
      if (spec?.kind === 'emoji' && /壁纸/.test(command.rest)) {
        await e.reply(`${game.name}的收录是表情包，发送 ${this.spec.letter}表情包。`)
        return true
      }
      if (spec?.videos && /^(?:影音|pv|PV|角色视频|其他视频)/.test(command.rest)) return this.showMedia(e, keyword)
      if (spec?.kind === 'video') return this.showMedia(e, keyword)
      try {
        const groups = await mediaGroups(this.spec.key)
        const chosen = keyword ? groups.find(item => item.name === keyword) || groups.find(item => item.name.includes(keyword)) : null
        if (!chosen) {
          await e.reply([`${game.name}${spec.name}`, ...groups.slice(0, 20).map(item => `${this.spec.letter}${spec.name} ${item.name}`)].join('\n'))
          return true
        }
        const images = await mediaImages(this.spec.key, chosen.name)
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

    async showMedia(e, keyword) {
      const game = gameOf(this.spec.key)
      const spec = mediaOf(this.spec.key)
      try {
        if (!keyword) {
          const items = await mediaGroups(this.spec.key)
          const groups = spec.groups || spec.videos || []
          const lines = groups.map(group => `${this.spec.letter}${group.name}（${items.filter(item => item.group === group.name).length}）`)
          await e.reply([`${game.name}${spec.name}`, ...lines, `搜索：${this.spec.letter}影音 名字`].join('\n'))
          return true
        }
        const result = await mediaVideos(this.spec.key, keyword)
        if (!result.items.length) {
          await e.reply(`${spec.name}没有找到「${keyword}」。`)
          return true
        }
        return this.showVideoPage(e, result.items, keyword, 1)
      } catch (err) {
        logger.error(`[${game.name}${spec.name}]`, err)
        await e.reply('视频获取失败，请稍后重试')
        return true
      }
    }

    async showVideoPage(e, items, keyword, page) {
      const size = 4
      const totalPage = Math.max(1, Math.ceil(items.length / size))
      const current = Math.min(Math.max(page, 1), totalPage)
      this.sessions.set(this.sessionKey(e), { kind: 'video', videos: items, keyword, page: current, time: Date.now() })
      const game = gameOf(this.spec.key)
      const start = (current - 1) * size
      const cards = items.slice(start, start + size).map((item, index) => ({
        name: `${start + index + 1}. ${item.name}`,
        text: item.summary || item.group || '',
        icons: item.cover ? [item.cover] : [],
      }))
      const next = current < totalPage ? `<br>下一页：${this.spec.letter}影音 ${keyword} ${current + 1}` : ''
      await this.replyImage(e, pageHtml({
        title: `「${keyword}」的视频`,
        subtitle: `${game.name} · 第 ${current}/${totalPage} 页 · 共 ${items.length} 条`,
        body: boardHtml(cards, { columns: 1 }),
        footer: `发送 ${this.spec.letter}${start + 1} 播放这一条${next}`,
        extraCss: GAME_CSS,
      }), items.slice(start, start + size).map((item, index) => `${start + index + 1}. ${item.name}`).join('\n'))
      return true
    }

    async playVideo(e, item) {
      try {
        const src = item.page ? await resolveVideo(this.spec.key, item.page) : (await mediaClip(this.spec.key, item.id))?.src
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

    async forwardImages(e, title, images) {
      const shown = images.slice(0, 30)
      if (!e.group?.makeForwardMsg) {
        await e.reply([title, ...shown.map(src => segment.image(src))])
        return
      }
      await e.reply(await e.group.makeForwardMsg(shown.map(src => ({ message: segment.image(src), nickname: title, user_id: 10000 }))))
    }
  }
}
