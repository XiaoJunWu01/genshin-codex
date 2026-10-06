import '../model/zzz.js'
import { gamePlugin } from './lib/query.js'

const focus = [
  { id: 'skill', name: '技能', aliases: ['技能'] },
  { id: 'cinema', name: '影画', aliases: ['影画'] },
  { id: 'ascension', name: '突破', aliases: ['突破', '养成', '材料', '晋升'] },
  { id: 'recommend', name: '推荐', aliases: ['推荐', '配队', '配装'] },
  { id: 'profile', name: '资料', aliases: ['资料', '信息'] },
  { id: 'voice', name: '配音', aliases: ['配音', '声优', 'CV'] },
  { id: 'story', name: '故事', aliases: ['故事', '背景'] },
  { id: 'portrait', name: '立绘', aliases: ['立绘', '原画', '全身'] },
  { id: 'video', name: '视频', aliases: ['视频', 'pv', 'PV', '动画'] },
  { id: 'detail', name: '全文', aliases: ['全文', '详细', '详情'] },
]

export default gamePlugin({
  key: 'zzz',
  letter: 'z',
  words: ['绝区零', '绝区'],
  name: '绝区零图鉴',
  dsc: '绝区零图鉴',
  focus,
  facts: entry => [['属性', entry.theme.element], ['特性', entry.theme.weapon], ['稀有度', entry.theme.rarity], ['阵营', entry.theme.faction]],
  layout: {
    skill: { columns: 1, showIcon: true },
    cinema: { columns: 1, showIcon: false },
    disk: { columns: 1, showIcon: false },
    story: { columns: 1, showIcon: false },
  },
  overview: new Set(['profile', 'ascension', 'recommend', 'effect', 'set']),
  help: ['z爱丽丝', 'z立绘 爱丽丝', 'z技能 爱丽丝', 'z影画 爱丽丝', 'z突破 爱丽丝', 'z音擎 绯月银棺', 'z驱动盘 呼啸沙龙', 'z影音 爱丽丝', 'z壁纸'],
})
