import plugin from '../../../lib/plugins/plugin.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import { getWikiConfig, resolvePluginPath } from '../config/config.js'
import { upcomingName } from '../model/alias.js'
import { mediaClip, mediaGroups, mediaVideos } from '../model/games.js'
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
const channelPattern = WIKI_CHANNELS.flatMap(channel => channel.aliases).sort((a, b) => b.length - a.length).join('|')
const reserved = ['图鉴', '观测枢', 'wiki', '背包', ...WIKI_CHANNELS.flatMap(channel => channel.aliases)]
  .sort((a, b) => b.length - a.length)
  .join('|')
// # 和 g 两种前缀都能进入全部指令，空格可有可无。
const lead = '#?g?'
const shortPattern = `^(?:${lead})(${WIKI_FOCUS_PATTERN})?\\s*(.+?)\\s*(${channelPattern})$`

import { cardsHtml, entryCss, escapeHtml, facesHtml, groupsHtml, imagesHtml, markText, placeholderGroup, profileGrid, resultCss, scalingHtml, talentTotal, themeOf } from './lib/theme.js'

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


export default class WikiPlugin extends plugin {
  constructor() {
    super({
      name: '观测枢图鉴',
      dsc: '原神观测枢角色、武器、圣遗物等图鉴查询',
      event: 'message',
      priority: 5,
      rule: [
        { reg: `^${lead}(?:图鉴帮助|观测枢帮助|wiki帮助)$`, fnc: 'showHelp' },
        { reg: `^${lead}(?:图鉴|观测枢)更新$`, fnc: 'updatePlugin', priority: 40 },
        { reg: `^${lead}(?:影音|影音回廊|pv|PV|角色视频|过场动画|其他视频)(?:\\s*\\S.*)?$`, fnc: 'gallery' },
        { reg: `^${lead}图鉴(目录|列表|分类)(?:\\s+.*)?$`, fnc: 'showCatalog' },
        { reg: `^${lead}图鉴(日历|今天)(?:\\s+\\d+)?$`, fnc: 'showCalendar' },
        { reg: `^${lead}(?:图鉴|观测枢|wiki)\\s*(.+)$`, fnc: 'query' },
        { reg: `^${lead}(${WIKI_FOCUS_PATTERN})\\s*(\\S+)$`, fnc: 'queryFocus' },
        { reg: `^${lead}(${channelPattern})\\s*(\\S+)$`, fnc: 'queryAlias', priority: 50 },
        { reg: `^${lead}([^\\s#]{1,16})(立绘|原画|全身|展示|动作|待机)$`, fnc: 'queryMedia', priority: 70 },
        { reg: shortPattern, fnc: 'queryShort', priority: 74 },
        { reg: '^#?g\\s*(\\S{2,})$', fnc: 'queryG', priority: 1 },
        { reg: '^#?g\\s*(\\d+)$', fnc: 'queryIndex', priority: 1 },
        { reg: `^#(?!${reserved})([^\\s#]{2,16})$`, fnc: 'queryBare', priority: 1 },
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
.container{--accent:${palette.color};--soft:${palette.soft};--ink:${palette.ink};width:1080px;padding:28px;background:rgba(255,255,255,.96);border:1px solid rgba(255,255,255,.7);border-radius:28px;box-shadow:0 10px 30px rgba(15,23,42,.16)}
.header{display:${theme ? 'none' : 'block'};margin-bottom:16px;padding:16px 20px;border-radius:18px;background:linear-gradient(135deg,var(--soft),#fff);border:1px solid rgba(15,23,42,.06)}
.header h1{font-size:34px;color:var(--ink);line-height:1.2}.subtitle{margin-top:6px;color:#64748b;font-size:20px}
.footer{margin-top:16px;padding:12px 16px;border-radius:16px;background:var(--soft);text-align:center;color:#64748b;font-size:18px;line-height:1.6}
${extraCss || ''}
</style></head><body><div class="page"><div class="container">
<div class="header"><h1>${title}</h1><div class="subtitle">${subtitle || ''}</div></div>
${body}<div class="footer">${footer || ''}</div></div></div>
<script>window.addEventListener('load',()=>{setTimeout(()=>{const page=document.querySelector('.page');if(!page)return;const rect=page.getBoundingClientRect();const w=Math.ceil(rect.width);const h=Math.ceil(rect.height);document.documentElement.style.width=w+'px';document.documentElement.style.height=h+'px';document.body.style.width=w+'px';document.body.style.height=h+'px'},100)})</script>
</body></html>`
  }

  async showHelp(e) {
    const version = pluginVersion()
    const bg = getBackgroundImageUrl()
    const groups = [
      ['查询', [
        ['#g角色 胡桃', '简介、满级突破和推荐装备', '角'],
        ['#薇斯纳', '优先于其他插件，直接出图', '查'],
        ['#地图 名字', '地图和其他同名内容', '图'],
        ['g蝶变', '角色、武器、圣遗物、敌人、食物', '名'],
        ['g胡桃立绘', '全身立绘原图', '绘'],
        ['g胡桃动作', '待机和技能动图', '动'],
        ['g图鉴 银釭', '按关键字搜索全部词条', '搜'],
      ]],
      ['角色分项', [
        ['#g天赋 胡桃', '天赋全文和升级材料', '天'],
        ['#g命座 胡桃', '六条命之座', '命'],
        ['#g突破 胡桃', '突破材料和满级合计', '突'],
        ['#g故事 胡桃', '角色故事和配音', '故'],
        ['#g资料 胡桃', '生日、称号和所属', '档'],
        ['g2', '打开上一次结果的第 2 条', '页'],
      ]],
      ['养成与世界', [
        ['#g武器 狼的末路', '武器效果、突破材料和推荐角色', '武'],
        ['#g圣遗物 饰金', '套装效果和推荐角色', '圣'],
        ['#g敌人 丘丘人', '敌人资料', '敌'],
        ['#g食物 甜甜花酿鸡', '食谱材料和食用效果', '食'],
        ['#g材料 霓裳花', '材料来源和用途', '材'],
        ['#g动物 虹晶星花鱼', '动物和生物', '兽'],
      ]],
      ['内容与终局', [
        ['#g成就 无束的残月', '成就达成条件', '成'],
        ['#g任务 至冬宫的来信', '魔神、传说和世界任务', '任'],
        ['#g委托 兽内不和', '冒险家协会每日委托', '委'],
        ['#g秘境 荒坠的圣迹', '秘境和洞天', '境'],
        ['#g深渊 深境螺旋第8层', '深渊、剧诗和危战', '渊'],
        ['#g行动牌 七循之理', '七圣召唤卡牌', '牌'],
      ]],
      ['收集与装扮', [
        ['#g名片 原神·印象', '名片原图', '片'],
        ['#g头像 锋锐', '头像', '像'],
        ['#g装扮 名字', '装扮和幻形', '饰'],
        ['#g灰眸 标识', '灰眸和组织', '眸'],
        ['#gNPC 叶尔莫莱', 'NPC 和商店', '人'],
        ['g影音 薇斯纳', '先看封面，再选一条播放', '影'],
      ]],
      ['原神 · g', [
        ['#g图鉴目录', '全部分类和筛选', '目'],
        ['#g图鉴目录 角色 火 五星', '元素、地区、星级、武器', '筛'],
        ['#g图鉴日历', '未来 7 天生日和材料', '历'],
        ['#g图鉴今天', '只看今天', '今'],
      ]],
      ['星穹铁道 · s', [
        ['s流萤', '立绘、资料、晋阶和行迹', 's'],
        ['s行迹 流萤', '行迹全文', '迹'],
        ['s星魂 流萤', '六条星魂', '魂'],
        ['s晋阶 流萤', '晋阶材料和满级属性', '阶'],
        ['s影音 流萤', '先选一条再播放', '影'],
        ['s光锥 记一位星神的陨落', '光锥效果和晋阶材料', '锥'],
        ['s表情包', '米游社表情包', '表'],
      ]],
      ['绝区零 · z', [
        ['z妮可', '立绘、资料、突破和技能', 'z'],
        ['z技能 妮可', '技能全文', '技'],
        ['z影画 妮可', '代理人影画', '画'],
        ['z突破 妮可', '突破材料和信赖奖励', '突'],
        ['z影音 妮可', '先选一条再播放', '影'],
        ['z音擎 聚宝箱', '音擎和突破材料', '擎'],
        ['z壁纸', '节日和版本壁纸', '纸'],
      ]],
      ...(e.isMaster ? [['主人设置', [
        ['#图鉴更新', '拉取插件更新', '新'],
      ]]] : []),
    ]
    const body = `<div class="help">
      <div class="mast">
        <div>
          <h1>观测枢图鉴</h1>
          <p>原神图鉴 · 米游社观测枢</p>
        </div>
        <b>${version ? 'v' + escapeHtml(version) : '图鉴'}</b>
      </div>
      ${groups.map(([title, items]) => `<section>
        <h2>${title}</h2>
        <div class="grid">${items.map(([cmd, desc, mark]) => `<div class="cell"><i>${mark}</i><div><b>${escapeHtml(cmd)}</b><span>${escapeHtml(desc)}</span></div></div>`).join('')}</div>
      </section>`).join('')}
      <div class="foot">原神 g，星铁 s，绝区零 z。空格可有可无。设置类指令只在主人的帮助里显示</div>
    </div>`
    await this.replyImage(e, this.wrapHtml({
      title: '观测枢图鉴',
      body,
      footer: '',
      extraCss: `body{background:#d7e3ef url("${bg}") center/cover no-repeat}.page{background:transparent;padding:28px}.container{width:900px;padding:0;background:transparent;box-shadow:none}.header,.footer{display:none}.help{display:flex;flex-direction:column;gap:14px}.mast{display:flex;align-items:flex-end;justify-content:space-between;padding:8px 8px 2px}.mast h1{color:#fff;font-size:46px;line-height:1;letter-spacing:.04em;text-shadow:0 6px 18px rgba(15,23,42,.45)}.mast p{margin-top:8px;color:rgba(255,255,255,.92);font-size:15px;letter-spacing:.08em;text-shadow:0 2px 8px rgba(15,23,42,.45)}.mast b{padding:7px 12px;border:1px solid rgba(255,255,255,.5);border-radius:12px;background:rgba(255,255,255,.16);color:#fff;font-size:14px;letter-spacing:.08em;backdrop-filter:blur(8px)}section{padding:16px;border:1px solid rgba(255,255,255,.34);border-radius:18px;background:rgba(17,24,39,.30);box-shadow:0 10px 28px rgba(15,23,42,.12);backdrop-filter:blur(8px)}section h2{margin-bottom:10px;color:#fff;font-size:16px;text-shadow:0 2px 8px rgba(15,23,42,.4)}section .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.cell{display:flex;align-items:flex-start;gap:8px;min-height:62px;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.08)}.cell i{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,.2);color:#fff;font-style:normal;font-size:13px;flex-shrink:0}.cell b{display:block;color:#fff;font-size:14px;line-height:1.35;text-shadow:0 1px 4px rgba(15,23,42,.4)}.cell span{display:block;margin-top:3px;color:rgba(241,245,249,.86);font-size:12px;line-height:1.4}.foot{color:rgba(255,255,255,.92);font-size:13px;text-align:center;text-shadow:0 2px 8px rgba(15,23,42,.45)}`,
    }), '发送 #图鉴帮助 查看全部指令')
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
          .map(channel => `<div class="channel"><i>${escapeHtml(channel.name.slice(0, 1))}</i><div><b>${escapeHtml(channel.name)}</b><span>#${escapeHtml(channel.aliases[0])} 名字</span></div></div>`)
          .join('')
        return `<section><h3>${title}</h3><div class="channels">${cards}</div></section>`
      }).join('')
      await this.replyImage(e, this.wrapHtml({
        title: '图鉴目录',
        subtitle: '先选分类，再叠加筛选',
        body: `<div class="groups">${body}</div>`,
        footer: '#图鉴目录 角色 火 五星 · #图鉴日历 · #图鉴今天',
        extraCss: '.groups{display:flex;flex-direction:column;gap:10px}section{padding:12px;border:1px solid rgba(15,23,42,.07);border-radius:14px;background:#fff}section h3{margin-bottom:8px;color:#334155;font-size:14px}.channels{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.channel{display:flex;align-items:center;gap:8px;min-height:58px;padding:9px 10px;border:1px solid rgba(15,23,42,.06);border-radius:12px;background:#f8fafc}.channel i{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--soft);color:var(--accent);font-style:normal;font-size:14px;font-weight:800;flex-shrink:0}.channel b{display:block;color:#1e293b;font-size:15px}.channel span{display:block;margin-top:2px;color:#64748b;font-size:12px}',
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
      ? (entry.attrs || []).filter(attr => focus || !/描述|故事|简介|件套|效果/.test(attr.key))
        .map(attr => `<div><em>${escapeHtml(attr.key)}</em><b>${escapeHtml(attr.value)}</b></div>`).join('')
      : ''
    const brief = section => {
      if (focus) return section
      if (section.focus === 'recommend') {
        return { ...section, text: '', lines: [], cards: section.cards || [] }
      }
      if (section.focus === 'voice') {
        return { ...section, title: '配音', cards: [], lines: section.lines?.length ? section.lines : (section.cards || []).map(card => card.name).filter(Boolean) }
      }
      if (section.focus === 'talent') {
        const total = talentTotal(section.groups)
        return total.length
          ? { ...section, title: '天赋材料', text: '', cards: [], groups: [], total }
          : { ...section, title: '天赋材料', text: '', cards: [], empty: '暂无天赋材料' }
      }
      if (section.focus === 'profile') {
        const effect = (section.cards || []).filter(card => /效果|件套|精炼|特效/.test(`${card.name}${card.text}`))
        return effect.length ? { ...section, text: '', cards: effect } : { ...section, cards: [] }
      }
      if (section.focus === 'ascension') return { ...section, groups: [], text: '' }
      return section
    }
    const source = focus?.id === 'detail'
      ? (entry.all || entry.sections || [])
      : (focus?.id === 'profile'
        ? [...(entry.parts?.profile || []), ...(entry.parts?.voice || [])]
        : (focus ? (entry.parts?.[focus.id] || []) : (entry.sections || [])))
    const shownAttrs = attrs && !source.some(section => section.focus === 'profile')
      ? `<div class="attrs">${attrs}</div>`
      : ''
    const sections = source.flatMap(section => {
      if (focus?.id === 'recommend') {
        const grouped = new Map()
        for (const card of section.cards || []) {
          const key = placeholderGroup(card.group) || section.title
          if (!grouped.has(key)) grouped.set(key, [])
          grouped.get(key).push(card)
        }
        if (grouped.size > 1) return [...grouped].map(([title, cards]) => ({ ...section, title, cards, group: '' }))
      }
      return [section]
    }).map(section => {
      const shown = brief(section)
      const pictures = focus ? imagesHtml(shown.images, shown.focus === 'showcase') : ''
      const profile = shown.focus === 'profile' && !(shown.cards || []).length ? profileGrid(shown.text) : ''
      const voices = shown.focus === 'voice'
        ? `<div class="voices">${(shown.lines || []).map(line => `<span>${escapeHtml(line)}</span>`).join('')}</div>`
        : ''
      const roles = shown.focus === 'recommend' ? facesHtml(shown.cards, shown.empty || '暂无角色推荐') : ''
      const prose = profile || voices || roles ? '' : (shown.text ? `<p>${markText(shown.text)}</p>` : '')
      const cards = roles ? '' : cardsHtml(shown.cards, shown.focus === 'talent' || shown.focus === 'constellation' ? 'stack' : '')
      const body = `${prose}${profile}${voices}${roles}${cards}${groupsHtml(shown.groups, shown.total)}`
      return `<section><h3>${escapeHtml(shown.title)}</h3>${body}${shown.empty && !shown.cards?.length && !shown.groups?.length && !shown.total?.length && !voices && !roles ? `<p class="empty">${escapeHtml(shown.empty)}</p>` : ''}${pictures}</section>`
    }).join('')
    const title = focus && focus.id !== 'detail' ? `${entry.name} · ${focus.name}` : entry.name
    const links = focus && focus.id !== 'detail' ? '' : this.focusLinks(entry)
    return `<div class="hero">${icon}<div class="hero-copy"><h2>${escapeHtml(title)}</h2>${facts ? `<div class="facts">${facts}</div>` : ''}<div class="tags">${tags}</div></div></div>${shownAttrs}${sections}${links}`
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
      footer: `发送 g序号 查看，例如 g${start + 1}${page < totalPage ? `<br>下一页：#图鉴 ${keyword} ${page + 1}` : ''}`,
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
      const clips = (entry.videos || []).map(clip => ({ name: clip.name || entry.name, src: clip.src, cover: '', summary: '', group: '角色视频' }))
      if (!clips.length) {
        await e.reply(`「${entry.name}」没有可播放的视频。`)
        return
      }
      return this.showVideoPage(e, clips, entry.name, 1)
    }
    const part = focus?.id === 'detail' ? null : (focus ? entry.parts?.[focus.id] || [] : null)
    if (focus && focus.id !== 'detail' && !part?.length) {
      await e.reply(`「${entry.name}」没有单独的${focus.name}内容。可以先看 #图鉴 ${entry.name}`)
      return
    }
    const hint = focus
      ? `返回总览：#图鉴 ${entry.name}`
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

  async gallery(e) {
    const raw = String(e.msg || '').replace(/^#?g?\s*/, '')
    const words = raw.split(/\s+/).filter(Boolean)
    const page = /^\d+$/.test(words.at(-1) || '') && words.length > 1 ? parseInt(words.pop(), 10) : 1
    const kind = /^(?:过场动画|其他视频|角色视频)/.test(words[0] || '') ? words.shift() : ''
    const keyword = words.join('').replace(/^(?:影音回廊|影音|pv|PV)/, '')
    try {
      if (!keyword && !kind) {
        const items = await mediaGroups('ys')
        const count = name => items.filter(item => item.group === name).length
        await e.reply(['原神影音', `g角色视频（${count('角色视频')}）`, `g过场动画（${count('过场动画')}）`, `g其他视频（${count('其他视频')}）`, '搜索：g影音 名字，选序号播放'].join('\n'))
        return true
      }
      const result = await mediaVideos('ys', keyword || kind)
      if (!result.items.length) {
        await e.reply(`影音没有找到「${keyword || kind}」。`)
        return true
      }
      return this.showVideoPage(e, result.items, keyword || kind, page)
    } catch (err) {
      logger.error('[原神影音]', err)
      await e.reply('影音获取失败，请稍后重试')
    }
    return true
  }

  async showVideoPage(e, items, keyword, page) {
    const size = 4
    const totalPage = Math.max(1, Math.ceil(items.length / size))
    const current = Math.min(Math.max(page, 1), totalPage)
    sessions.set(this.sessionKey(e), { kind: 'video', videos: items, keyword, time: Date.now() })
    const start = (current - 1) * size
    const rows = items.slice(start, start + size).map((item, index) => {
      const no = start + index + 1
      const icon = item.cover ? `<img src="${escapeHtml(item.cover)}" alt="">` : '<span class="placeholder"></span>'
      const summary = clipText(item.summary || item.group || '', 72)
      return `<div class="result">${icon}<div><b>${no}. ${escapeHtml(item.name)}</b><span>${escapeHtml(item.group || '视频')}</span>${summary ? `<em>${escapeHtml(summary)}</em>` : ''}</div></div>`
    }).join('')
    const next = current < totalPage ? `<br>下一页：g影音 ${keyword} ${current + 1}` : ''
    await this.replyImage(e, this.wrapHtml({
      title: `「${keyword}」的视频`,
      subtitle: `第 ${current}/${totalPage} 页 · 共 ${items.length} 条`,
      body: `<div class="results">${rows}</div>`,
      footer: `发送 #图鉴${start + 1} 播放这一条${next}`,
      extraCss: resultCss,
    }), items.slice(start, start + size).map((item, index) => `${start + index + 1}. ${item.name}`).join('\n'))
    return true
  }

  async playVideo(e, item) {
    try {
      const src = /^https?:/i.test(item.src || '') ? item.src : (await mediaClip('ys', item.id))?.src
      if (!src) {
        await e.reply(`「${item.name}」暂时无法播放。`)
        return true
      }
      await e.reply([item.name, segment.video(src)])
    } catch (err) {
      logger.error('[原神影音]', err)
      await e.reply('视频获取失败，请稍后重试')
    }
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
    return this.showEntry(e, { id: entry.id, name: entry.name }, '', { id: 'video', name: '视频' })
  }

  async queryShort(e) {
    const matched = String(e.msg || '').match(new RegExp(shortPattern))
    const channel = findWikiChannel(matched?.[3])
    const keyword = String(matched?.[2] || '').trim()
    if (!channel || !keyword || keyword.length > 12 || keyword.length < 2 || /^(图鉴|观测枢|wiki)$/.test(keyword)) return false
    const focus = findWikiFocus(matched?.[1])
    e.msg = focus ? `#g${focus.name} ${keyword}` : `#图鉴 ${channel.name} ${keyword}`
    return focus ? this.queryFocus(e) : this.query(e)
  }

  async queryMedia(e) {
    const matched = String(e.msg || '').match(new RegExp(`^${lead}([^\\s#]{1,12})(立绘|原画|全身|展示|动作|待机)$`))
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
    try {
      const found = await this.openExact(e, keyword)
      const upcoming = !found ? upcomingName('gs', keyword) : ''
      if (upcoming) await e.reply(`暂无「${upcoming}」的角色数据，敬请期待。`)
    } catch (err) {
      logger.error('[观测枢图鉴]', err)
      await e.reply('图鉴查询失败：' + (err.message || '请稍后重试'))
    }
    return true
  }

  async queryBare(e) {
    const keyword = String(e.msg || '').replace(/^#/, '').trim()
    if (!keyword || keyword.length > 16 || /^\d+$/.test(keyword)) return false
    const found = await this.openExact(e, keyword)
    return found ? true : false
  }

  async queryIndex(e) {
    const index = parseInt(String(e.msg || '').replace(/^#?g\s*/, ''), 10)
    e.msg = `#图鉴 ${index}`
    return this.query(e)
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
      footer: '例如 g1',
      extraCss: resultCss,
    }), `${keyword}有多个同名词条`)
    return true
  }

  async queryFocus(e) {
    const matched = String(e.msg || '').match(new RegExp(`^${lead}(${WIKI_FOCUS_PATTERN})\\s*(\\S+)$`))
    const focus = findWikiFocus(matched?.[1])
    const keyword = matched?.[2] || ''
    if (!focus || !keyword) return false
    try {
      const results = await searchWiki(keyword, { limit: 8 })
      const exact = results.filter(item => item.score >= 100)
      if (!exact.length) {
        await e.reply(`没有找到「${keyword}」。可以先看 #图鉴 ${keyword}`)
        return true
      }
      const chosen = this.uniqueHit(exact)
      if (chosen) {
        await this.showEntry(e, chosen, '', focus)
        return true
      }
      sessions.set(this.sessionKey(e), { results: exact, keyword, focus: focus.id, time: Date.now() })
      const view = this.resultListHtml(exact, 1, keyword)
      await this.replyImage(e, this.wrapHtml({
        title: `「${keyword}」`,
        subtitle: `选一个再看${focus.name}`,
        body: view.body,
        footer: `发送 g序号 查看${focus.name}，例如 g1`,
        extraCss: resultCss,
      }))
    } catch (err) {
      logger.error('[观测枢图鉴]', err)
      await e.reply('图鉴查询失败：' + (err.message || '请稍后重试'))
    }
    return true
  }

  async queryAlias(e) {
    const matched = String(e.msg || '').match(new RegExp(`^${lead}(${channelPattern})\\s*(\\S+)$`))
    if (!matched) return false
    e.msg = `#图鉴 ${matched[1]} ${matched[2]}`
    return this.query(e)
  }

  async query(e) {
    const input = String(e.msg || '').replace(/^#?g?(?:图鉴|观测枢|wiki)\s*/i, '').trim()
    if (!input || /^(帮助|菜单)$/.test(input)) return this.showHelp(e)
    const parsed = parseWikiQuery(input)
    const key = this.sessionKey(e)

    try {
      if (/^\d+$/.test(input)) {
        const cached = sessions.get(key)
        const index = parseInt(input, 10) - 1
        if (cached?.kind === 'video' && cached.videos && Date.now() - cached.time < 10 * 60 * 1000) {
          const item = cached.videos[index]
          if (!item) {
            await e.reply(`没有第 ${index + 1} 条。当前共 ${cached.videos.length} 条。`)
            return true
          }
          return this.playVideo(e, item)
        }
        const target = cached && Date.now() - cached.time < 10 * 60 * 1000
          ? cached.results[index]
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
      const matched = parsed.channel ? results : results.filter(item => item.score >= 100)
      if (!matched.length) {
        await e.reply(parsed.channel
          ? `${parsed.channel.name}里没有「${parsed.keyword}」。`
          : `没有找到「${parsed.keyword}」。名字差一个字时，用 #图鉴 ${parsed.keyword} 搜索`)
        return true
      }
      sessions.set(key, { results: matched, keyword: parsed.keyword, time: Date.now() })

      const chosen = parsed.page === 1 ? this.uniqueHit(matched) : null
      if (chosen) {
        const extra = matched.length > 1 ? `还有 ${matched.length - 1} 个相关结果，发送 g2 查看` : ''
        await this.showEntry(e, chosen, extra)
        return true
      }

      const view = this.resultListHtml(matched, parsed.page, [parsed.channel?.name, parsed.keyword].filter(Boolean).join(' '))
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

