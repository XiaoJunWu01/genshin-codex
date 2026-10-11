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
  mark: '%',
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
  overview: new Set(['profile', 'story', 'ascension', 'recommend', 'effect', 'set']),
  common: ['%角色 妮可', '%音擎 聚宝箱', '%驱动盘 呼啸沙龙'],
  help: ['%妮可', '%角色 妮可', '%立绘 妮可', '%技能 妮可', '%影画 妮可', '%突破 妮可', '%推荐 妮可', '%故事 妮可', '%资料 妮可', '%配音 妮可', '%妮可专武', '%音擎 聚宝箱', '%驱动盘 呼啸沙龙', '%敌人 歹徒', '%材料 丁尼', '%地图 妮可', '%影音 妮可', '%角色视频', '%其他视频', '%壁纸', '%图鉴目录'],
})
