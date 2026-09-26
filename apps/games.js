import plugin from '../../../lib/plugins/plugin.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import {
  channelOf, channelPattern, focusOf, focusPattern, gameOf,
  getGameEntry, listGame, searchGame,
} from '../model/games.js'

const sessions = new Map()
const GAMES = [
  { key: 'sr', letter: 's', words: ['星铁', '星穹铁道', '崩铁'] },
  { key: 'zzz', letter: 'z', words: ['绝区零', '绝区'] },
]

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
        { reg: `^(?:#|g)?(?:${words})(?:\\s*帮助)?$`, fnc: 'help' },
        { reg: `^(?:#|g)?(?:${words})\\s*\\S+`, fnc: 'query' },
      ],
    })
  }

  sessionKey(e, key) {
    return `${key}:${e.group_id ? 'g' + e.group_id : 'u' + e.user_id}`
  }

  async help(e) {
    const command = commandOf(e.msg)
    if (command.rest && command.rest !== '帮助') return false
    const game = gameOf(command.key)
    const lines = command.key === 'sr'
      ? ['s流萤', 's角色 流萤', 's行迹 流萤', 's星魂 流萤', 's光锥 记一位友人', 's遗器 宝命长存的莳者']
      : ['z妮可', 'z代理人 妮可', 'z技能 妮可', 'z影画 妮可', 'z音擎 聚宝箱', 'z邦布 艾米莉安']
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
      const channel = channelOf(command.key, rest.split(/\s+/)[0])
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
      const rows = results.map((item, index) => `${index + 1}. ${item.name}（${item.channelName || '词条'}）`).join('\n')
      await e.reply(`${game.name}有多个结果，发送 ${mark(game)}1 打开对应条目\n${rows}`)
    } catch (err) {
      logger.error(`[${game.name}图鉴]`, err)
      await e.reply(`${game.name}图鉴查询失败，请稍后重试`)
    }
    return true
  }

  async catalog(e, key, channel) {
    const game = gameOf(key)
    if (!channel) {
      await e.reply(`${game.name}分类：${channelPattern(key).split('|').join('、')}`)
      return true
    }
    const result = await listGame(key, channel, 1)
    const names = result.items.slice(0, 12).map(item => item.name).join('、')
    await e.reply(`${game.name}${channel.name}共 ${result.total} 条\n${names}${result.total > 12 ? '…' : ''}\n查询：${mark(game)}${channel.name} 名字`)
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
    const entry = await getGameEntry(key, target.id)
    const source = focus ? entry.parts?.[focus.id] || [] : entry.sections || []
    if (focus && !source.length) {
      await e.reply(`「${entry.name}」没有单独的${focus.name}内容。`)
      return true
    }
    const lines = [`${entry.name}${focus ? ' · ' + focus.name : ''}`, (entry.tags || []).join(' · ')]
    for (const section of source.slice(0, 4)) {
      lines.push('', section.title)
      if (section.text) lines.push(section.text.slice(0, 240))
      for (const card of (section.cards || []).slice(0, 4)) lines.push(`${card.name}：${String(card.text || '').replace(/\s+/g, ' ').slice(0, 80)}`)
    }
    const links = !focus && entry.parts ? Object.keys(entry.parts).map(id => focusOf(key, id)?.name).filter(Boolean) : []
    if (links.length) lines.push('', '可继续查看：' + links.map(name => `${mark(game)}${name} ${entry.name}`).join('  '))
    await e.reply(lines.filter(item => item !== undefined).join('\n'))
    return true
  }
}
