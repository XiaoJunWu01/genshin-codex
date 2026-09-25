import plugin from '../../../lib/plugins/plugin.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import { getWikiConfig, resolvePluginPath } from '../config/config.js'
import {
  WIKI_CHANNELS,
  WIKI_FOCUS,
  WIKI_FOCUS_PATTERN,
  WIKI_PAGE_SIZE,
  clipText,
  findWikiFocus,
  getWikiEntry,
  listWikiChannel,
  parseWikiQuery,
  searchWiki,
} from '../model/wiki.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.join(__dirname, '..')
const sessions = new Map()

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function textBlock(value) {
  return escapeHtml(value).replace(/\n/g, '<br>')
}

function pathToFileURLSafe(filePath) {
  return 'file:///' + filePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

function getBackgroundImageUrl() {
  const configBg = resolvePluginPath(getWikiConfig().backgroundPath)
  if (configBg) {
    if (/^https?:\/\//i.test(configBg) || /^file:\/\//i.test(configBg)) return configBg
    if (fs.existsSync(configBg)) return pathToFileURLSafe(configBg)
  }
  const filePath = path.join(pluginRoot, 'resources', 'background', 'bg.png')
  return fs.existsSync(filePath) ? pathToFileURLSafe(filePath) : ''
}

function cardsHtml(cards) {
  const items = cards || []
  if (!items.length) return ''
  return `<div class="equips">${items.map((card, index) => {
    const group = card.group && card.group !== items[index - 1]?.group
      ? `<div class="group">${escapeHtml(card.group)}</div>`
      : ''
    const icons = (card.icons?.length ? card.icons : [card.icon]).filter(Boolean)
    const icon = icons.length
      ? `<div class="icons">${icons.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('')}</div>`
      : '<span class="placeholder"></span>'
    const text = card.text ? `<p>${textBlock(card.text)}</p>` : ''
    return `${group}<div class="equip">${icon}<div><b>${escapeHtml(card.name || '')}</b>${text}</div></div>`
  }).join('')}</div>`
}

const ELEMENT_THEMES = {
  风: ['#378383', '#e7f6f4', '#123734'],
  火: ['#B8584B', '#fff1ec', '#4a201b'],
  水: ['#518ABB', '#eef6ff', '#17324d'],
  雷: ['#6455A6', '#f4f1ff', '#2c244d'],
  冰: ['#5FACC1', '#eefbff', '#173d48'],
  岩: ['#C09257', '#fff7ec', '#463318'],
  草: ['#6D9840', '#f4faec', '#243814'],
}

function themeOf(entry) {
  const theme = entry?.theme || {}
  const preset = ELEMENT_THEMES[theme.element] || ['#456990', '#f4f7fb', '#1e293b']
  return {
    element: theme.element || '',
    weapon: theme.weapon || '',
    rarity: theme.rarity || '',
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

function imagesHtml(images, motion = false) {
  const items = images || []
  if (!items.length) return ''
  const shots = items.map(item => {
    const label = item.name ? `<b>${escapeHtml(item.name)}</b>` : ''
    return `<div class="shot"><img src="${escapeHtml(item.src)}" alt="">${label}</div>`
  }).join('')
  return `<div class="${motion ? 'motions' : 'gallery'}">${shots}</div>`
}

function groupsHtml(groups, total = []) {
  const rows = (groups || []).map(group => {
    const items = (group.materials || []).map(materialHtml).join('')
    const note = group.note ? `<small>${textBlock(group.note)}</small>` : ''
    return `<div class="level"><b>${escapeHtml(group.name)}</b><div>${items}</div>${note}</div>`
  }).join('')
  const summary = total?.length
    ? `<div class="level total"><b>满级合计</b><div>${total.map(materialHtml).join('')}</div></div>`
    : ''
  return rows || summary ? `<div class="levels">${rows}${summary}</div>` : ''
}

const entryCss = `
.hero{position:relative;display:flex;gap:16px;align-items:center;min-height:168px;margin:-24px -24px 16px;padding:24px;border-radius:18px 18px 0 0;background:
linear-gradient(135deg,var(--soft),#fff 58%),
radial-gradient(circle at 92% 18%,var(--accent),transparent 34%)}
.cover{width:112px;height:112px;object-fit:contain;border-radius:24px;background:
radial-gradient(circle at 50% 42%,#fff,var(--soft) 72%);
border:4px solid #fff;box-shadow:0 8px 18px rgba(0,0,0,.12);flex-shrink:0}
.hero h2{color:var(--ink);font-size:34px;line-height:1.05}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.facts span{min-width:78px;padding:7px 10px;border-radius:12px;background:#fff;border-top:4px solid var(--accent);box-shadow:0 2px 8px rgba(15,23,42,.06)}
.facts em{display:block;color:#64748b;font-style:normal;font-size:11px;font-weight:700}
.facts b{color:var(--ink);font-size:16px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.tags span{padding:3px 8px;border-radius:999px;background:var(--accent);color:#fff;font-size:12px;font-weight:700}
.attrs{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.attrs div{padding:8px 10px;background:var(--soft);border-radius:12px;border-left:4px solid var(--accent)}
.attrs em{display:block;color:#64748b;font-style:normal;font-size:12px}
.attrs b{color:var(--ink);font-size:14px}
section{margin-top:12px;padding:12px 14px;background:var(--soft);border-radius:14px}
section h3{margin-bottom:6px;padding-left:9px;border-left:4px solid var(--accent);color:var(--ink);font-size:16px}
section p{color:#334155;font-size:14px;line-height:1.65;word-break:break-word}
.levels{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.level{padding:8px;border-radius:12px;background:rgba(255,255,255,.88)}
.level>b{display:block;margin-bottom:6px;color:var(--ink);font-size:13px}
.level>div{display:flex;flex-wrap:wrap;gap:6px}
.mat{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:3px 7px 3px 3px;border-radius:999px;background:#fff;border:1px solid rgba(15,23,42,.06)}
.mat img{width:26px;height:26px;object-fit:contain;border-radius:50%;background:var(--soft)}
.mat em{color:#334155;font-style:normal;font-size:12px}
.mat b{color:var(--accent);font-size:12px}
.level small{display:block;margin-top:5px;color:#64748b;font-size:12px;line-height:1.5}
.total{background:#fff}
.equips{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.group{margin-top:4px;color:var(--accent);font-size:13px;font-weight:800}
.equip{display:flex;align-items:flex-start;gap:10px;padding:8px;border-radius:12px;background:rgba(255,255,255,.9)}
.equip .icons{display:flex;gap:4px;flex-shrink:0}
.equip .icons img,.equip>img,.equip>.placeholder{width:54px;height:54px;object-fit:contain;border-radius:12px;background:var(--soft)}
.equip b{display:block;color:var(--ink);font-size:14px;line-height:1.4}
.equip p{margin-top:3px;color:#475569;font-size:12px;line-height:1.7}
.more{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:14px}
.more em{color:#64748b;font-style:normal;font-size:12px}
.more span{padding:4px 8px;border-radius:999px;background:#fff;border:1px solid rgba(15,23,42,.08);color:var(--accent);font-size:12px;font-weight:700}
.gallery{display:flex;flex-direction:column;gap:12px;margin-top:8px}
.shot{padding:8px;border-radius:14px;background:rgba(255,255,255,.9)}
.shot img{display:block;width:100%;max-height:920px;object-fit:contain;border-radius:10px;background:#fff}
.shot b{display:block;margin-top:6px;color:var(--ink);font-size:13px;text-align:center}
.motions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}
.motions .shot img{max-height:280px;background:var(--soft)}
`

export default class WikiPlugin extends plugin {
  constructor() {
    super({
      name: '观测枢图鉴',
      dsc: '原神观测枢角色、武器、圣遗物等图鉴查询',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#?(?:g)?(?:图鉴帮助|观测枢帮助|wiki帮助)$', fnc: 'showHelp' },
        { reg: '^#?图鉴(目录|列表|分类)(?:\\s+(\\S+))?(?:\\s+(\\d+))?$', fnc: 'showCatalog' },
        { reg: '^#?(?:图鉴|观测枢|wiki)\\s*(.+)$', fnc: 'query' },
        { reg: `^#g(${WIKI_FOCUS_PATTERN})\\s*(\\S+)$`, fnc: 'queryFocus' },
        { reg: '^#(角色|人物|武器|圣遗物|遗物|敌人|怪物|魔物|食物|料理|食谱|材料|素材|道具)\\s*(\\S+)$', fnc: 'queryAlias', priority: 50 },
      ],
    })
  }

  async render(html) {
    const tmpDir = path.join(pluginRoot, 'temp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const tplFile = path.join(tmpDir, `wiki_${Date.now()}.html`)
    fs.writeFileSync(tplFile, html)
    try {
      return await puppeteer.screenshot('dps-plugin', {
        tplFile,
        imgType: 'png',
        fullPage: false,
      })
    } catch (err) {
      logger.error('[观测枢图鉴] 截图失败:', err)
      return null
    } finally {
      try { fs.unlinkSync(tplFile) } catch {}
    }
  }

  wrapHtml({ title, subtitle, body, footer, extraCss, theme }) {
    const palette = theme || themeOf({})
    const pageBg = `background:linear-gradient(145deg,${palette.soft} 0%,${palette.color} 140%);`
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}html,body{overflow:hidden}
body{display:inline-block;font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif;background:transparent}
.page{display:inline-block;${pageBg}padding:20px}
.container{--accent:${palette.color};--soft:${palette.soft};--ink:${palette.ink};width:760px;background:rgba(255,255,255,.94);border-radius:18px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:24px}
.header{display:${theme ? 'none' : 'block'};text-align:center;margin-bottom:18px;padding-bottom:12px;border-bottom:2px solid rgba(226,232,240,.75)}
.header h1{font-size:24px;color:#1e293b}.subtitle{margin-top:4px;color:#64748b;font-size:13px}
.footer{margin-top:14px;padding-top:10px;border-top:1px solid rgba(226,232,240,.75);text-align:center;color:#64748b;font-size:13px;line-height:1.7}
${extraCss || ''}
</style></head><body><div class="page"><div class="container">
<div class="header"><h1>${title}</h1><div class="subtitle">${subtitle || ''}</div></div>
${body}<div class="footer">${footer || ''}</div></div></div>
<script>window.addEventListener('load',()=>{setTimeout(()=>{const page=document.querySelector('.page');if(!page)return;const rect=page.getBoundingClientRect();const w=Math.ceil(rect.width);const h=Math.ceil(rect.height);document.documentElement.style.width=w+'px';document.documentElement.style.height=h+'px';document.body.style.width=w+'px';document.body.style.height=h+'px'},100)})</script>
</body></html>`
  }

  async showHelp(e) {
    const body = `<div class="help-list">
      <div class="help-title">角色</div>
      <div><b>#角色 胡桃</b><span>总览：资料、推荐装备、特殊料理</span></div>
      <div><b>#g天赋 胡桃</b><span>天赋全文和升级材料</span></div>
      <div><b>#g命座 胡桃</b><span>六条命之座</span></div>
      <div><b>#g突破 胡桃</b><span>各阶段突破材料和满级合计</span></div>
      <div><b>#g故事 胡桃</b><span>角色介绍、故事和配音</span></div>
      <div><b>#g资料 胡桃</b><span>生日、定位、所属、称号</span></div>
      <div><b>#g立绘 胡桃</b><span>全身立绘</span></div>
      <div><b>#g展示 胡桃</b><span>待机和技能动作</span></div>
      <div class="help-title">其他图鉴</div>
      <div><b>#武器 狼的末路</b><span>武器属性和突破材料</span></div>
      <div><b>#圣遗物 绝缘之旗印</b><span>套装效果、单件和推荐角色</span></div>
      <div><b>#敌人 丘丘人</b><span>敌人资料。#魔物 相同</span></div>
      <div><b>#食物 甜甜花酿鸡</b><span>食谱材料和食用效果</span></div>
      <div><b>#材料 霓裳花</b><span>材料来源和用途</span></div>
      <div class="help-title">搜索</div>
      <div><b>#图鉴 银釭</b><span>不限分类搜索，唯一结果直接出图</span></div>
      <div><b>#图鉴2</b><span>打开刚才搜索结果的第 2 条</span></div>
      <div><b>#图鉴目录 武器</b><span>浏览分类，翻页加数字</span></div>
    </div>`
    await this.replyImage(e, this.wrapHtml({
      title: '观测枢图鉴',
      subtitle: '数据来自米游社观测枢公开词条',
      body,
      footer: '角色细分都加 g：天赋、命座、突破、故事、资料、立绘、展示。支持雷神、万叶这类别名。裸写 #胡桃 不会触发。',
      extraCss: '.help-list{display:flex;flex-direction:column;gap:8px}.help-title{margin-top:4px;color:#64748b;font-size:12px;font-weight:800}.help-list div{display:flex;justify-content:space-between;gap:16px;padding:10px 12px;background:#f8fafc;border-radius:12px}.help-title{display:block;padding:2px 2px 0;background:transparent}.help-list b{color:#1d4ed8;white-space:nowrap}.help-list span{color:#475569;text-align:right}',
    }), '发送 #图鉴 名称 查询，例如 #图鉴 银釭')
    return true
  }

  async showCatalog(e) {
    const matched = String(e.msg || '').match(/^#?图鉴(?:目录|列表|分类)(?:\s+(\S+))?(?:\s+(\d+))?$/)
    const name = matched?.[1] || ''
    const page = parseInt(matched?.[2] || '1', 10)
    if (!name) {
      const cards = WIKI_CHANNELS.map(channel => `<div class="channel">${escapeHtml(channel.name)}</div>`).join('')
      await this.replyImage(e, this.wrapHtml({
        title: '图鉴目录',
        subtitle: '发送 #图鉴目录 分类名',
        body: `<div class="channels">${cards}</div>`,
        footer: '例如 #图鉴目录 武器',
        extraCss: '.channels{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.channel{padding:18px 8px;text-align:center;background:#f8fafc;border-radius:14px;font-size:18px;font-weight:800;color:#1e293b}',
      }))
      return true
    }

    const channel = WIKI_CHANNELS.find(item => item.name === name || item.aliases.includes(name))
    if (!channel) {
      await e.reply('没有这个分类。可选：角色、武器、圣遗物、敌人、食物、材料')
      return true
    }

    try {
      const result = await listWikiChannel(channel, page)
      const cards = result.items.map((item, index) => {
        const no = (result.page - 1) * 24 + index + 1
        const icon = item.icon ? `<img src="${escapeHtml(item.icon)}" alt="">` : '<span class="placeholder"></span>'
        return `<div class="card">${icon}<div><b>${no}. ${escapeHtml(item.name)}</b></div></div>`
      }).join('')
      await this.replyImage(e, this.wrapHtml({
        title: `${channel.name}图鉴`,
        subtitle: `第 ${result.page}/${result.totalPage} 页，共 ${result.total} 条`,
        body: `<div class="grid">${cards}</div>`,
        footer: result.page < result.totalPage ? `下一页：#图鉴目录 ${channel.name} ${result.page + 1}` : '已是最后一页',
        extraCss: '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{display:flex;align-items:center;gap:8px;min-height:58px;padding:8px;background:#f8fafc;border-radius:12px}.card img,.placeholder{width:42px;height:42px;border-radius:10px;object-fit:cover;background:#e2e8f0;flex-shrink:0}.card b{font-size:13px;color:#1e293b;line-height:1.35}',
      }))
    } catch (err) {
      logger.error('[观测枢图鉴]', err)
      await e.reply('图鉴目录获取失败，请稍后重试')
    }
    return true
  }

  async replyImage(e, html, fallback) {
    const img = await this.render(html)
    if (img) return e.reply(img)
    return e.reply(fallback || '图片渲染失败，请稍后重试')
  }

  entryHtml(entry, focus = null) {
    const theme = themeOf(entry)
    const icon = entry.icon ? `<img class="cover" src="${escapeHtml(entry.icon)}" alt="">` : ''
    const facts = [
      theme.element && ['元素', theme.element],
      theme.weapon && ['武器', theme.weapon],
      theme.rarity && ['稀有度', theme.rarity],
    ].filter(Boolean).map(([key, value]) => `<span><em>${escapeHtml(key)}</em><b>${escapeHtml(value)}</b></span>`).join('')
    const tags = (entry.tags || []).filter(tag => ![theme.element, theme.weapon, theme.rarity].includes(tag))
      .map(tag => `<span>${escapeHtml(tag)}</span>`).join('')
    const attrs = !focus || focus.id === 'profile'
      ? (entry.attrs || []).map(attr => `<div><em>${escapeHtml(attr.key)}</em><b>${escapeHtml(attr.value)}</b></div>`).join('')
      : ''
    const source = focus ? (entry.parts?.[focus.id] || []) : (entry.sections || [])
    const sections = source.map(section => {
      const pictures = imagesHtml(section.images, section.focus === 'showcase')
      return `<section><h3>${escapeHtml(section.title)}</h3>${section.text ? `<p>${textBlock(section.text)}</p>` : ''}${cardsHtml(section.cards)}${groupsHtml(section.groups, section.total)}${pictures}</section>`
    }).join('')
    const title = focus ? `${entry.name} · ${focus.name}` : entry.name
    const links = focus ? '' : this.focusLinks(entry)
    return `<div class="hero">${icon}<div class="hero-copy"><h2>${escapeHtml(title)}</h2>${facts ? `<div class="facts">${facts}</div>` : ''}<div class="tags">${tags}</div></div></div>${attrs ? `<div class="attrs">${attrs}</div>` : ''}${sections}${links}`
  }

  focusLinks(entry) {
    const parts = entry.parts || {}
    const links = WIKI_FOCUS
      .filter(focus => parts[focus.id]?.length)
      .map(focus => `<span>#g${focus.name} ${escapeHtml(entry.name)}</span>`)
      .join('')
    return links ? `<div class="more"><em>分开查看</em>${links}</div>` : ''
  }

  resultListHtml(results, page, keyword) {
    const start = (page - 1) * WIKI_PAGE_SIZE
    const pageItems = results.slice(start, start + WIKI_PAGE_SIZE)
    const totalPage = Math.max(1, Math.ceil(results.length / WIKI_PAGE_SIZE))
    const rows = pageItems.map((item, index) => {
      const no = start + index + 1
      const icon = item.icon ? `<img src="${escapeHtml(item.icon)}" alt="">` : '<span class="placeholder"></span>'
      const summary = clipText(item.summary || '', 42)
      return `<div class="result">${icon}<div><b>${no}. ${escapeHtml(item.name)}</b><span>${escapeHtml(item.channelName || '词条')}</span>${summary ? `<em>${escapeHtml(summary)}</em>` : ''}</div></div>`
    }).join('')
    return {
      totalPage,
      body: `<div class="results">${rows}</div>`,
      footer: `发送 #图鉴序号 查看，例如 #图鉴${start + 1}${page < totalPage ? `<br>下一页：#图鉴 ${keyword} ${page + 1}` : ''}`,
    }
  }

  sessionKey(e) {
    return e.group_id ? `wiki:g:${e.group_id}` : `wiki:u:${e.user_id}`
  }

  async showEntry(e, target, extraFooter = '', focus = null) {
    const entry = await getWikiEntry(target.id)
    const part = focus ? entry.parts?.[focus.id] || [] : null
    if (focus && !part.length) {
      await e.reply(`「${entry.name}」没有单独的${focus.name}内容。可以先看 #角色 ${entry.name}`)
      return
    }
    const hint = focus
      ? `返回总览：#角色 ${entry.name}`
      : (extraFooter || '数据来源：米游社观测枢')
    await this.replyImage(e, this.wrapHtml({
      title: focus ? `${entry.name} · ${focus.name}` : entry.name,
      subtitle: target.channelName || '观测枢词条',
      body: this.entryHtml(entry, focus),
      footer: extraFooter && focus ? `${extraFooter}<br>${hint}` : hint,
      extraCss: entryCss,
      theme: themeOf(entry),
    }))
  }

  async queryFocus(e) {
    const matched = String(e.msg || '').match(new RegExp(`^#g(${WIKI_FOCUS_PATTERN})\\s*(\\S+)$`))
    const focus = findWikiFocus(matched?.[1])
    const keyword = matched?.[2] || ''
    if (!focus || !keyword) return false
    try {
      const results = await searchWiki(keyword, { channelId: 25, limit: 8 })
      if (!results.length) {
        await e.reply(`没有找到角色「${keyword}」。可以换成更完整的名字，例如 #g${focus.name} 胡桃`)
        return true
      }
      const exact = results.filter(item => item.score === 100)
      if (results[0].score === 100 && exact.length === 1) {
        await this.showEntry(e, results[0], '', focus)
        return true
      }
      sessions.set(this.sessionKey(e), { results, keyword, focus: focus.id, time: Date.now() })
      const view = this.resultListHtml(results, 1, keyword)
      await this.replyImage(e, this.wrapHtml({
        title: `「${keyword}」的角色`,
        subtitle: `选一个再看${focus.name}`,
        body: view.body,
        footer: `发送 #图鉴序号 查看${focus.name}，例如 #图鉴1`,
        extraCss: '.results{display:flex;flex-direction:column;gap:8px}.result{display:flex;align-items:center;gap:12px;padding:10px;background:#f8fafc;border-radius:12px}.result img,.placeholder{width:52px;height:52px;border-radius:12px;object-fit:cover;background:#e2e8f0;flex-shrink:0}.result b{display:block;color:#1e293b;font-size:16px}.result span{display:inline-block;margin-top:3px;padding:1px 7px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:12px}.result em{display:block;margin-top:3px;color:#64748b;font-style:normal;font-size:12px}',
      }))
    } catch (err) {
      logger.error('[观测枢图鉴]', err)
      await e.reply('图鉴查询失败：' + (err.message || '请稍后重试'))
    }
    return true
  }

  async queryAlias(e) {
    const matched = String(e.msg || '').match(/^#(角色|人物|武器|圣遗物|遗物|敌人|怪物|魔物|食物|料理|食谱|材料|素材|道具)\s*(\S+)$/)
    if (!matched) return false
    e.msg = `#图鉴 ${matched[1]} ${matched[2]}`
    return this.query(e)
  }

  async query(e) {
    const input = String(e.msg || '').replace(/^#?(?:图鉴|观测枢|wiki)\s*/i, '').trim()
    if (!input || /^(帮助|菜单)$/.test(input)) return this.showHelp(e)
    const parsed = parseWikiQuery(input)
    const key = this.sessionKey(e)

    try {
      if (/^\d+$/.test(input)) {
        const cached = sessions.get(key)
        const target = cached && Date.now() - cached.time < 10 * 60 * 1000
          ? cached.results[parseInt(input, 10) - 1]
          : null
        if (!target) {
          await e.reply('没有这条序号。请先搜索，例如 #图鉴 银釭')
          return true
        }
        await this.showEntry(e, target, '', findWikiFocus(cached.focus))
        return true
      }

      if (!parsed.keyword && parsed.channel) {
        e.msg = `#图鉴目录 ${parsed.channel.name}${parsed.page > 1 ? ' ' + parsed.page : ''}`
        return this.showCatalog(e)
      }

      const results = await searchWiki(parsed.keyword, { channelId: parsed.channel?.id || 0, limit: 20 })
      if (!results.length) {
        await e.reply(`没有找到「${parsed.keyword}」。可以换成更完整的名字，或加分类，例如 #图鉴 武器 ${parsed.keyword}`)
        return true
      }
      sessions.set(key, { results, keyword: parsed.keyword, time: Date.now() })

      const exactCount = results.filter(item => item.score === 100).length
      if (results[0].score === 100 && exactCount === 1 && parsed.page === 1) {
        const extra = results.length > 1 ? `还有 ${results.length - 1} 个相关结果，发送 #图鉴2 查看` : ''
        await this.showEntry(e, results[0], extra)
        return true
      }

      const view = this.resultListHtml(results, parsed.page, [parsed.channel?.name, parsed.keyword].filter(Boolean).join(' '))
      await this.replyImage(e, this.wrapHtml({
        title: `「${parsed.keyword}」的搜索结果`,
        subtitle: parsed.channel ? `分类：${parsed.channel.name}` : '发送序号查看详情',
        body: view.body,
        footer: view.footer,
        extraCss: '.results{display:flex;flex-direction:column;gap:8px}.result{display:flex;align-items:center;gap:12px;padding:10px;background:#f8fafc;border-radius:12px}.result img,.placeholder{width:52px;height:52px;border-radius:12px;object-fit:cover;background:#e2e8f0;flex-shrink:0}.result b{display:block;color:#1e293b;font-size:16px}.result span{display:inline-block;margin-top:3px;padding:1px 7px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:12px}.result em{display:block;margin-top:3px;color:#64748b;font-style:normal;font-size:12px}',
      }))
    } catch (err) {
      logger.error('[观测枢图鉴]', err)
      await e.reply('图鉴查询失败：' + (err.message || '请稍后重试'))
    }
    return true
  }
}

