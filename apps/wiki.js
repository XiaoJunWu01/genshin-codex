import plugin from '../../../lib/plugins/plugin.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import { execFile } from 'child_process'
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
  findWikiChannel,
  findWikiFocus,
  getWikiEntry,
  listWikiChannel,
  parseWikiQuery,
  searchWiki,
} from '../model/wiki.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.join(__dirname, '..')
const sessions = new Map()
const videoEnabled = new Map()
const channelPattern = WIKI_CHANNELS.flatMap(channel => channel.aliases).sort((a, b) => b.length - a.length).join('|')
const shortPattern = `^(?:#?g)?(${WIKI_FOCUS_PATTERN})?\\s*(.+?)\\s*(${channelPattern})$`

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

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: pluginRoot,
      timeout: 60000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || stdout || err.message).trim() || 'git 执行失败'))
      else resolve(String(stdout || '').trim())
    })
  })
}

function pluginVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')).version || ''
  } catch {
    return ''
  }
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
        { reg: '^#?(?:图鉴|观测枢)更新$', fnc: 'updatePlugin', priority: 40 },
        { reg: '^#?图鉴视频(?:\\s*(开|关))?$', fnc: 'toggleVideo' },
        { reg: '^#?图鉴(目录|列表|分类)(?:\\s+(\\S+))?(?:\\s+(\\d+))?$', fnc: 'showCatalog' },
        { reg: '^#?(?:图鉴|观测枢|wiki)\\s*(.+)$', fnc: 'query' },
        { reg: `^#g(${WIKI_FOCUS_PATTERN})\\s*(\\S+)$`, fnc: 'queryFocus' },
        { reg: '^#(角色|人物|武器|圣遗物|遗物|敌人|怪物|魔物|食物|料理|食谱|材料|素材|道具)\\s*(\\S+)$', fnc: 'queryAlias', priority: 50 },
        { reg: '^#?([^\\s#]{1,12})(立绘|原画|全身|展示|动作|待机)$', fnc: 'queryMedia', priority: 70 },
        { reg: `^#?g(?!(?:${WIKI_FOCUS_PATTERN}))\\s*(\\S+)$`, fnc: 'queryG', priority: 75 },
        { reg: shortPattern, fnc: 'queryShort', priority: 80 },
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
    const on = this.videoOn(e)
    const version = pluginVersion()
    const bg = getBackgroundImageUrl()
    const groups = [
      ['角色资料', [
        ['#角色 胡桃', '角色总览'],
        ['#g天赋 胡桃', '天赋和升级材料'],
        ['#g命座 胡桃', '六条命之座'],
        ['#g突破 胡桃', '突破材料'],
        ['#g故事 胡桃', '故事和配音'],
        ['#g资料 胡桃', '生日、称号、所属'],
      ]],
      ['图片和动作', [
        ['胡桃立绘', '全身立绘原图'],
        ['胡桃动作', '待机和技能动图'],
        ['g薇纳斯', '直接查角色'],
        ['沃雅尼莎立绘', '差一个字也能对上'],
        ['#图鉴2', '打开上次第 2 条'],
        ['#图鉴视频开', `视频当前${on ? '已开启' : '已关闭'}`],
      ]],
      ['其他图鉴', [
        ['#武器 狼的末路', '武器属性和材料'],
        ['饰金圣遗物', '套装和推荐角色'],
        ['丘丘人敌人', '敌人资料'],
        ['#食物 甜甜花酿鸡', '食谱和效果'],
        ['#材料 霓裳花', '来源和用途'],
        ['#图鉴目录 武器', '按分类翻页'],
      ]],
    ]
    const body = `<div class="help">
      <div class="mast">
        <div>
          <h1>观测枢图鉴</h1>
          <p>Yunzai · 米游社观测枢</p>
        </div>
        <b>miHoYo</b>
      </div>
      ${groups.map(([title, items]) => `<section>
        <h2>${title}</h2>
        <div class="grid">${items.map(([cmd, desc]) => `<div class="cell"><b>${escapeHtml(cmd)}</b><span>${escapeHtml(desc)}</span></div>`).join('')}</div>
      </section>`).join('')}
      <div class="foot">名字能对上就直接出图。新角色随观测枢更新，不用改插件。${version ? ' v' + escapeHtml(version) : ''}</div>
    </div>`
    await this.replyImage(e, this.wrapHtml({
      title: '观测枢图鉴',
      body,
      footer: '',
      extraCss: `body{background:#d7e3ef url("${bg}") center/cover no-repeat}.page{background:transparent;padding:28px}.container{width:860px;padding:0;background:transparent;box-shadow:none}.header,.footer{display:none}.help{display:flex;flex-direction:column;gap:14px}.mast{display:flex;align-items:flex-end;justify-content:space-between;padding:8px 8px 2px}.mast h1{color:#fff;font-size:46px;line-height:1;letter-spacing:.04em;text-shadow:0 6px 18px rgba(15,23,42,.45)}.mast p{margin-top:8px;color:rgba(255,255,255,.86);font-size:15px;letter-spacing:.08em}.mast b{padding:7px 12px;border:1px solid rgba(255,255,255,.45);border-radius:12px;background:rgba(255,255,255,.18);color:#fff;font-size:14px;letter-spacing:.14em;backdrop-filter:blur(12px)}section{padding:16px;border:1px solid rgba(255,255,255,.38);border-radius:18px;background:rgba(17,24,39,.46);box-shadow:0 10px 28px rgba(15,23,42,.18);backdrop-filter:blur(16px)}section h2{margin-bottom:10px;color:#fff;font-size:16px}section .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.cell{min-height:62px;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.10)}.cell b{display:block;color:#f8fafc;font-size:14px;line-height:1.35}.cell span{display:block;margin-top:3px;color:rgba(226,232,240,.78);font-size:12px;line-height:1.4}.foot{color:rgba(255,255,255,.9);font-size:13px;text-align:center;text-shadow:0 2px 8px rgba(15,23,42,.45)}`,
    }), '发送 #角色 胡桃，或 胡桃立绘')
    return true
  }

  async updatePlugin(e) {
    if (!e.isMaster) {
      await e.reply('只有主人可以更新图鉴插件。')
      return true
    }
    await e.reply('正在拉取观测枢图鉴更新…')
    try {
      const before = await runGit(['rev-parse', '--short', 'HEAD']).catch(() => '')
      await runGit(['fetch', '--all', '--prune'])
      const remote = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => 'origin/master')
      await runGit(['pull', '--ff-only'])
      const after = await runGit(['rev-parse', '--short', 'HEAD']).catch(() => '')
      const note = await runGit(['log', '-1', '--pretty=%s']).catch(() => '')
      if (before && before === after) {
        await e.reply(`已经是最新。${after}${note ? ' ' + note : ''}`)
        return true
      }
      await e.reply(`已从 ${remote} 更新到 ${after || '最新'}。${note ? note + '。' : ''}请重启 Yunzai 后生效。`)
    } catch (err) {
      logger.error('[观测枢图鉴] 更新失败:', err)
      await e.reply('更新失败：' + String(err.message || err).slice(0, 180))
    }
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
    if (focus?.id === 'portrait') return this.sendPortraits(e, entry)
    if (focus?.id === 'showcase') return this.sendMotions(e, entry)
    if (focus?.id === 'video' || (!focus && entry.videos?.length && !entry.sections?.length)) {
      return this.sendVideos(e, entry)
    }
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

  videoOn(e) {
    return videoEnabled.get(this.sessionKey(e)) === true
  }

  async toggleVideo(e) {
    const matched = String(e.msg || '').match(/^#?图鉴视频(?:\s*(开|关))?$/)
    const key = this.sessionKey(e)
    const next = matched?.[1] ? matched[1] === '开' : !this.videoOn(e)
    videoEnabled.set(key, next)
    await e.reply(next
      ? '已开启本插件的角色视频解析。查询角色视频词条时会直接发视频，其他链接仍不处理。'
      : '已关闭角色视频解析。')
    return true
  }

  async sendPortraits(e, entry) {
    const pictures = entry.portraits?.length ? entry.portraits : (entry.theme?.portrait ? [{ src: entry.theme.portrait, name: entry.name }] : [])
    if (!pictures.length) {
      await e.reply(`「${entry.name}」还没有全身立绘。`)
      return
    }
    const sent = []
    for (const picture of pictures) {
      const img = segment.image(picture.src)
      sent.push(picture.name && pictures.length > 1 ? [picture.name, img] : img)
    }
    await e.reply(sent.flat())
  }

  async sendMotions(e, entry) {
    const motions = entry.motions || []
    if (!motions.length) {
      await e.reply(`「${entry.name}」还没有动作展示。`)
      return
    }
    if (!e.group?.makeForwardMsg) {
      await e.reply(['动作展示：', ...motions.flatMap(item => [item.name || '动作', segment.image(item.src)])])
      return
    }
    const forward = await e.group.makeForwardMsg(motions.map(item => ({
      message: [item.name || '动作', segment.image(item.src)],
      nickname: entry.name,
      user_id: 10000,
    })))
    const icon = entry.icon || ''
    if (icon && forward?.data) {
      const nodes = Array.isArray(forward.data) ? forward.data : null
      for (const node of nodes || []) {
        const author = node?.data
        if (!author || typeof author !== 'object') continue
        if ('name' in author || 'uin' in author || 'avatar' in author) author.avatar = icon
      }
      if (!nodes && typeof forward.data === 'object') forward.data.avatar = icon
    }
    await e.reply(forward)
  }

  uniqueHit(results) {
    if (results.length === 1) return results[0]
    const exact = results.filter(item => item.score >= 100)
    return exact.length === 1 ? exact[0] : null
  }

  async sendVideos(e, entry) {
    if (!this.videoOn(e)) {
      await e.reply('角色视频解析默认关闭。发送 #图鉴视频开 后，再查这一条。')
      return
    }
    const clips = entry.videos || []
    if (!clips.length) {
      await e.reply(`「${entry.name}」没有可播放的视频。`)
      return
    }
    await e.reply(clips.flatMap(clip => [clip.name || entry.name, segment.video(clip.src)]))
  }

  async queryShort(e) {
    const matched = String(e.msg || '').match(new RegExp(shortPattern))
    const channel = findWikiChannel(matched?.[3])
    const keyword = String(matched?.[2] || '').trim()
    if (!channel || !keyword || keyword.length > 12 || /^(图鉴|观测枢|wiki)$/.test(keyword)) return false
    const focus = findWikiFocus(matched?.[1])
    e.msg = focus ? `#g${focus.name} ${keyword}` : `#图鉴 ${channel.name} ${keyword}`
    return focus ? this.queryFocus(e) : this.query(e)
  }

  async queryMedia(e) {
    const matched = String(e.msg || '').match(/^#?([^\s#]{1,12})(立绘|原画|全身|展示|动作|待机)$/)
    const focus = findWikiFocus(matched?.[2])
    const keyword = matched?.[1] || ''
    if (!focus || !keyword || /^(图鉴|观测枢|wiki|角色|武器)$/.test(keyword)) return false
    e.msg = `#g${focus.name} ${keyword}`
    return this.queryFocus(e)
  }

  async queryG(e) {
    const keyword = String(e.msg || '').replace(/^#?g\s*/, '').trim()
    if (!keyword || keyword.length > 12 || /帮助|视频|图鉴|目录|列表/.test(keyword)) return false
    e.msg = `#图鉴 角色 ${keyword}`
    return this.query(e)
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
      const chosen = this.uniqueHit(results)
      if (chosen) {
        await this.showEntry(e, chosen, '', focus)
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

      const chosen = parsed.page === 1 ? this.uniqueHit(results) : null
      if (chosen) {
        const extra = results.length > 1 ? `还有 ${results.length - 1} 个相关结果，发送 #图鉴2 查看` : ''
        await this.showEntry(e, chosen, extra)
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

