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
  getWikiCalendar,
  parseCatalogQuery,
  parseWikiQuery,
  searchWiki,
} from '../model/wiki.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.join(__dirname, '..')
const sessions = new Map()
const videoEnabled = new Map()
const channelPattern = WIKI_CHANNELS.flatMap(channel => channel.aliases).sort((a, b) => b.length - a.length).join('|')
const reserved = ['图鉴', '观测枢', 'wiki', '背包', ...WIKI_CHANNELS.flatMap(channel => channel.aliases)]
  .sort((a, b) => b.length - a.length)
  .join('|')
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

const resultCss = '.results{display:flex;flex-direction:column;gap:8px}.result{display:flex;align-items:center;gap:12px;padding:10px;background:#fff;border:1px solid rgba(15,23,42,.07);border-radius:12px;border-left:4px solid var(--accent)}.result img,.placeholder{width:48px;height:48px;border-radius:12px;object-fit:cover;background:#f1f5f9;flex-shrink:0}.result b{display:block;color:#1e293b;font-size:15px}.result span{display:inline-block;margin-top:3px;padding:1px 7px;border-radius:999px;background:var(--soft);color:var(--accent);font-size:12px}.result em{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:3px;color:#64748b;font-style:normal;font-size:12px;line-height:1.5}'

const entryCss = `
.hero{display:flex;gap:16px;align-items:center;padding:16px;border:1px solid rgba(15,23,42,.08);border-radius:16px;background:linear-gradient(135deg,#fff,var(--soft))}
.cover{width:92px;height:92px;object-fit:contain;border-radius:20px;background:radial-gradient(circle at 50% 42%,#fff,var(--soft) 72%);border:1px solid rgba(15,23,42,.06);flex-shrink:0}
.hero h2{color:var(--ink);font-size:30px;line-height:1.1}
.facts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.facts span{min-width:64px;padding:5px 9px;border-radius:10px;background:#fff;border:1px solid rgba(15,23,42,.06);border-top:3px solid var(--accent)}
.facts em{display:block;color:#64748b;font-style:normal;font-size:11px}
.facts b{color:var(--ink);font-size:15px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tags span{padding:2px 8px;border-radius:999px;background:var(--accent);color:#fff;font-size:12px}
.attrs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
.attrs div{padding:8px 10px;background:#fff;border:1px solid rgba(15,23,42,.07);border-radius:12px;border-left:4px solid var(--accent)}
.attrs em{display:block;color:#64748b;font-style:normal;font-size:12px}
.attrs b{color:var(--ink);font-size:14px;line-height:1.45}
section{margin-top:10px;padding:12px;border:1px solid rgba(15,23,42,.08);border-radius:14px;background:#fff}
section h3{display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--ink);font-size:15px}
section h3::before{content:\"\";width:4px;height:14px;border-radius:4px;background:var(--accent)}
section p{color:#334155;font-size:14px;line-height:1.7;word-break:break-word}
.levels{display:flex;flex-direction:column;gap:6px}
.level{padding:8px;border-radius:10px;background:var(--soft)}
.level>b{display:block;margin-bottom:6px;color:var(--ink);font-size:13px}
.level>div{display:flex;flex-wrap:wrap;gap:6px}
.mat{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 8px 2px 2px;border-radius:999px;background:#fff;border:1px solid rgba(15,23,42,.06)}
.mat img{width:24px;height:24px;object-fit:contain;border-radius:50%;background:var(--soft)}
.mat em{color:#334155;font-style:normal;font-size:12px}
.mat b{color:var(--accent);font-size:12px}
.level small{display:block;margin-top:5px;color:#64748b;font-size:12px;line-height:1.5}
.total{background:#fff;border:1px dashed var(--accent)}
.equips{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.group{grid-column:1/-1;margin-top:2px;color:var(--accent);font-size:13px;font-weight:800}
.equip{display:flex;align-items:flex-start;gap:8px;min-height:72px;padding:8px;border-radius:12px;background:var(--soft);border:1px solid rgba(15,23,42,.05)}
.equip .icons{display:flex;gap:3px;flex-shrink:0}
.equip .icons img,.equip>img,.equip>.placeholder{width:46px;height:46px;object-fit:contain;border-radius:10px;background:#fff}
.equip b{display:block;color:var(--ink);font-size:13px;line-height:1.35}
.equip p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:3px;color:#475569;font-size:12px;line-height:1.55}
.more{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:12px;padding:10px;border-radius:12px;background:var(--soft)}
.more em{color:#64748b;font-style:normal;font-size:12px}
.more span{padding:4px 8px;border-radius:999px;background:#fff;border:1px solid rgba(15,23,42,.08);color:var(--accent);font-size:12px}
.gallery{display:flex;flex-direction:column;gap:10px}
.shot{padding:8px;border-radius:12px;background:var(--soft);border:1px solid rgba(15,23,42,.05)}
.shot img{display:block;width:100%;max-height:760px;object-fit:contain;border-radius:10px;background:#fff}
.shot b{display:block;margin-top:6px;color:var(--ink);font-size:13px;text-align:center}
.motions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.motions .shot img{max-height:240px}
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
        { reg: '^#?图鉴(目录|列表|分类)(?:\\s+.*)?$', fnc: 'showCatalog' },
        { reg: '^#?图鉴(日历|今天)(?:\\s+\\d+)?$', fnc: 'showCalendar' },
        { reg: '^#?(?:图鉴|观测枢|wiki)\\s*(.+)$', fnc: 'query' },
        { reg: `^#g(${WIKI_FOCUS_PATTERN})\\s*(\\S+)$`, fnc: 'queryFocus' },
        { reg: `^#(${channelPattern})\\s*(\\S+)$`, fnc: 'queryAlias', priority: 50 },
        { reg: '^#?([^\\s#]{1,16})(立绘|原画|全身|展示|动作|待机)$', fnc: 'queryMedia', priority: 70 },
        { reg: '^#?g\\s*(\\S+)$', fnc: 'queryG', priority: 75 },
        { reg: `^#(?!${reserved})([^\\s#]{1,16})$`, fnc: 'queryBare', priority: 78 },
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
.page{display:inline-block;${pageBg}padding:18px}
.container{--accent:${palette.color};--soft:${palette.soft};--ink:${palette.ink};width:760px;padding:16px;background:rgba(255,255,255,.96);border:1px solid rgba(255,255,255,.7);border-radius:22px;box-shadow:0 10px 30px rgba(15,23,42,.16)}
.header{display:${theme ? 'none' : 'block'};margin-bottom:12px;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,var(--soft),#fff);border:1px solid rgba(15,23,42,.06)}
.header h1{font-size:22px;color:var(--ink);line-height:1.2}.subtitle{margin-top:3px;color:#64748b;font-size:13px}
.footer{margin-top:12px;padding:8px 12px;border-radius:12px;background:var(--soft);text-align:center;color:#64748b;font-size:12px;line-height:1.6}
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
        ['g薇纳斯', '角色、武器、圣遗物、敌人、食物'],
        ['#蝶变', '名字完全一致时直接出图'],
        ['#图鉴2', '打开上一次的第 2 条'],
        ['#图鉴视频开', `角色视频当前${on ? '已开启' : '已关闭'}`],
      ]],
      ['其他图鉴', [
        ['#武器 狼的末路', '武器属性和材料'],
        ['#圣遗物 饰金', '套装和推荐角色'],
        ['#敌人 丘丘人', '敌人资料'],
        ['#动物 虹晶星花鱼', '动物、书籍、秘境'],
        ['#成就 无束的残月', '成就、任务、委托'],
        ['#名片 原神·印象', '名片、头像、装扮'],
      ]],
      ['目录和日历', [
        ['#图鉴目录', '全部分类'],
        ['#图鉴目录 角色 火 五星', '元素、地区、星级、武器'],
        ['#图鉴目录 深渊', '深渊、剧诗、危战'],
        ['#图鉴日历', '未来 7 天生日和材料'],
        ['#图鉴今天', '只看今天'],
        ['#图鉴日历 3', '自定义天数，最多 14 天'],
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
      <div class="foot">${version ? 'v' + escapeHtml(version) : ''}</div>
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
    const parsed = parseCatalogQuery(String(e.msg || ''))
    if (!parsed.channel) {
      const groups = [
        ['养成', [25, 5, 218, 13]],
        ['世界', [6, 21, 49, 20, 54, 130, 276]],
        ['内容', [252, 43, 55, 68, 105]],
        ['终局', [65, 249, 275, 260]],
        ['收集', [109, 244, 211, 278, 255]],
        ['七圣召唤', [233, 234, 235]],
      ]
      const body = groups.map(([title, ids]) => {
        const cards = ids.map(id => WIKI_CHANNELS.find(channel => channel.id === id)).filter(Boolean)
          .map(channel => `<div class="channel"><b>${escapeHtml(channel.name)}</b><span>#${escapeHtml(channel.aliases[0])} 名字</span></div>`)
          .join('')
        return `<section><h3>${title}</h3><div class="channels">${cards}</div></section>`
      }).join('')
      await this.replyImage(e, this.wrapHtml({
        title: '图鉴目录',
        subtitle: '先选分类，再叠加筛选',
        body: `<div class="groups">${body}</div>`,
        footer: '#图鉴目录 角色 火 五星 · #图鉴日历 · #图鉴今天',
        extraCss: '.groups{display:flex;flex-direction:column;gap:10px}section{padding:12px;border:1px solid rgba(15,23,42,.07);border-radius:14px;background:#fff}section h3{margin-bottom:8px;color:#334155;font-size:14px}.channels{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.channel{min-height:58px;padding:9px 10px;border:1px solid rgba(15,23,42,.06);border-radius:12px;background:#f8fafc;border-top:3px solid var(--accent)}.channel b{display:block;color:#1e293b;font-size:15px}.channel span{display:block;margin-top:3px;color:#64748b;font-size:12px}',
      }), '发送 #图鉴目录 角色，或 #图鉴目录 角色 火 五星')
      return true
    }

    try {
      const result = await listWikiChannel(parsed.channel, parsed.page, parsed.filters)
      const label = `${parsed.channel.name}${parsed.filters.length ? ' · ' + parsed.filters.join(' · ') : ''}`
      if (!result.total) {
        const hint = result.schema
          .map(group => `${group.label}：${group.options.slice(0, 8).join('、')}`)
          .join('\n')
        await e.reply(`「${label}」没有匹配的词条。\n${hint}`)
        return true
      }
      if (result.page > result.totalPage) {
        await e.reply(`「${label}」共 ${result.totalPage} 页。发送 #图鉴目录 ${parsed.channel.name}${parsed.filters.length ? ' ' + parsed.filters.join(' ') : ''} ${result.totalPage}`)
        return true
      }
      const cards = result.items.map(item => {
        const icon = item.icon ? `<img src="${escapeHtml(item.icon)}" alt="">` : '<span class="placeholder"></span>'
        const tags = Object.values(item.filters || {}).flat().slice(0, 3)
        return `<div class="card">${icon}<b>${escapeHtml(item.name)}</b><span>${escapeHtml(tags.join(' · '))}</span></div>`
      }).join('')
      const condition = parsed.filters.length ? parsed.filters.join(' ') : '全部'
      const again = ['#图鉴目录', parsed.channel.name, ...parsed.filters].join(' ')
      await this.replyImage(e, this.wrapHtml({
        title: `${parsed.channel.name}图鉴`,
        subtitle: `${condition} · 第 ${result.page}/${result.totalPage} 页 · 共 ${result.total} 条`,
        body: `<div class="grid">${cards}</div>`,
        footer: result.page < result.totalPage ? `下一页：${again} ${result.page + 1}` : '已是最后一页',
        extraCss: '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.card{display:flex;flex-direction:column;align-items:center;gap:6px;min-height:124px;padding:10px 6px;background:#fff;border:1px solid rgba(15,23,42,.07);border-radius:14px;text-align:center}.card img,.placeholder{width:64px;height:64px;border-radius:50%;object-fit:cover;background:#f1f5f9;border:1px solid rgba(15,23,42,.05)}.card b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#1e293b;font-size:13px;line-height:1.3}.card span{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;color:#64748b;font-size:11px}',
      }), `${parsed.channel.name}图鉴，共 ${result.total} 条`)
    } catch (err) {
      logger.error('[观测枢图鉴]', err)
      await e.reply('图鉴目录获取失败，请稍后重试')
    }
    return true
  }

  async showCalendar(e) {
    const todayOnly = /今天/.test(String(e.msg || ''))
    const days = todayOnly ? 1 : Math.min(14, parseInt(String(e.msg || '').match(/(\d+)\s*$/)?.[1] || '7', 10))
    try {
      const { rows } = await getWikiCalendar(days)
      const seriesOf = name => String(name || '').split(/的|之/)[0].replace(/[「」]/g, '')
      const groups = items => {
        const map = new Map()
        for (const item of items) {
          const key = seriesOf(item.name)
          if (!map.has(key)) map.set(key, { name: key, icon: item.icon || '', grades: [] })
          map.get(key).grades.push(item)
        }
        return [...map.values()]
      }
      const books = items => groups(items).map(group => {
        const icon = group.icon ? `<img src="${escapeHtml(group.icon)}" alt="">` : ''
        const grades = group.grades.map(item => `<i>${escapeHtml(item.name)}</i>`).join('')
        return `<div class="book">${icon}<div><b>${escapeHtml(group.name)}</b>${grades}</div></div>`
      }).join('')
      const birthdays = items => items.length
        ? items.map(item => {
          const icon = item.icon ? `<img src="${escapeHtml(item.icon)}" alt="">` : ''
          return `<span>${icon}${escapeHtml(item.name)}</span>`
        }).join('')
        : '<em>无</em>'
      const body = `<div class="days">${rows.map(row => `<section>
        <h3><b>${escapeHtml(row.label)}</b><span>${escapeHtml(row.date)} ${escapeHtml(row.week)}</span></h3>
        <div class="line birth"><em>生日</em><div>${birthdays(row.birthdays)}</div></div>
        <div class="line"><em>天赋</em><div>${row.open ? '<i class="all">全部开放</i>' : books(row.talent)}</div></div>
        <div class="line"><em>武器</em><div>${row.open ? '<i class="all">全部开放</i>' : books(row.weapon)}</div></div>
      </section>`).join('')}</div>`
      await this.replyImage(e, this.wrapHtml({
        title: todayOnly ? '今日图鉴' : '图鉴日历',
        subtitle: '生日、天赋本和武器本',
        body,
        footer: '卡池和活动时间不在观测枢日历里，这里不显示',
        extraCss: '.days{display:flex;flex-direction:column;gap:12px}section{padding:14px;border:1px solid rgba(15,23,42,.07);border-radius:16px;background:#fff}h3{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(15,23,42,.06)}h3 b{color:#1e293b;font-size:18px}h3 span{color:#64748b;font-size:13px}.line{display:flex;gap:10px;margin-top:10px}.line>em{width:34px;flex-shrink:0;padding-top:8px;color:#64748b;font-style:normal;font-size:13px}.line>div{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;flex:1}.book{display:flex;gap:8px;min-width:0;padding:8px;border:1px solid rgba(15,23,42,.06);border-radius:12px;background:#f8fafc}.book img{width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0}.book b{display:block;color:#1e293b;font-size:14px;line-height:1.3}.book i{display:block;margin-top:2px;color:#64748b;font-style:normal;font-size:11px;line-height:1.35}.birth>div{display:flex;flex-wrap:wrap;gap:6px}.birth span{display:flex;align-items:center;gap:6px;padding:3px 10px 3px 3px;border-radius:999px;background:#f8fafc;color:#1e293b;font-size:13px}.birth img{width:24px;height:24px;border-radius:50%;object-fit:cover}.all{grid-column:1/-1;align-self:center;color:#94a3b8;font-style:normal;font-size:14px}.birth em{padding-top:4px}',
      }), '图鉴日历')
    } catch (err) {
      logger.error('[观测枢图鉴]', err)
      await e.reply('日历获取失败，请稍后重试')
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
    if (!keyword || keyword.length > 16 || /帮助|视频|图鉴|目录|列表|更新/.test(keyword)) return false
    if (findWikiFocus(keyword)) return false
    const found = await this.openExact(e, keyword)
    return found ? true : false
  }

  async queryBare(e) {
    const keyword = String(e.msg || '').replace(/^#/, '').trim()
    if (!keyword || keyword.length > 16 || /^\d+$/.test(keyword)) return false
    const found = await this.openExact(e, keyword)
    return found ? true : false
  }

  async openExact(e, keyword, focus = null) {
    const results = await searchWiki(keyword, { limit: 30 })
    const exact = results.filter(item => item.score >= 100)
    if (!exact.length) return false
    const chosen = this.uniqueHit(exact)
    if (chosen) {
      await this.showEntry(e, chosen, '', focus)
      return true
    }
    sessions.set(this.sessionKey(e), { results: exact, keyword, focus: focus?.id || '', time: Date.now() })
    const view = this.resultListHtml(exact, 1, keyword)
    await this.replyImage(e, this.wrapHtml({
      title: `「${keyword}」`,
      subtitle: '有多个同名词条，发送序号打开',
      body: view.body,
      footer: '例如 #图鉴1',
      extraCss: resultCss,
    }), `${keyword}有多个同名词条`)
    return true
  }

  async queryFocus(e) {
    const matched = String(e.msg || '').match(new RegExp(`^#g(${WIKI_FOCUS_PATTERN})\\s*(\\S+)$`))
    const focus = findWikiFocus(matched?.[1])
    const keyword = matched?.[2] || ''
    if (!focus || !keyword) return false
    try {
      const results = await searchWiki(keyword, { channelId: 25, limit: 8 })
      if (!results.length) {
        await e.reply(`没有找到角色「${keyword}」。`)
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
        extraCss: resultCss,
      }))
    } catch (err) {
      logger.error('[观测枢图鉴]', err)
      await e.reply('图鉴查询失败：' + (err.message || '请稍后重试'))
    }
    return true
  }

  async queryAlias(e) {
    const matched = String(e.msg || '').match(new RegExp(`^#(${channelPattern})\\s*(\\S+)$`))
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
        await e.reply(`没有找到「${parsed.keyword}」。`)
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
        extraCss: resultCss,
      }))
    } catch (err) {
      logger.error('[观测枢图鉴]', err)
      await e.reply('图鉴查询失败：' + (err.message || '请稍后重试'))
    }
    return true
  }
}

