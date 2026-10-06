import '../model/sr.js'
import { gamePlugin } from './lib/query.js'

const focus = [
  { id: 'trace', name: '行迹', aliases: ['行迹', '技能'] },
  { id: 'eidolon', name: '星魂', aliases: ['星魂'] },
  { id: 'ascension', name: '晋阶', aliases: ['晋阶', '突破', '养成', '材料'] },
  { id: 'effect', name: '效果', aliases: ['效果'] },
  { id: 'recommend', name: '推荐', aliases: ['推荐', '配队', '配装'] },
  { id: 'profile', name: '资料', aliases: ['资料', '信息'] },
  { id: 'voice', name: '配音', aliases: ['配音', '声优', 'CV'] },
  { id: 'story', name: '故事', aliases: ['故事', '背景'] },
  { id: 'portrait', name: '立绘', aliases: ['立绘', '原画', '全身'] },
  { id: 'video', name: '视频', aliases: ['视频', 'pv', 'PV', '动画'] },
  { id: 'detail', name: '全文', aliases: ['全文', '详细', '详情'] },
]

export default gamePlugin({
  key: 'sr',
  letter: 's',
  words: ['星铁', '星穹铁道', '崩铁'],
  name: '星穹铁道图鉴',
  dsc: '崩坏：星穹铁道图鉴',
  focus,
  facts: entry => [['属性', entry.theme.element], ['命途', entry.theme.path], ['星级', entry.theme.rarity]],
  layout: {
    trace: { columns: 1, showIcon: true },
    eidolon: { columns: 1, showIcon: true },
    skill: { columns: 1, showIcon: true },
    effect: { columns: 1, showIcon: false },
  },
  overview: new Set(['profile', 'ascension', 'recommend', 'effect', 'set']),
  common: ['s角色 流萤', 's光锥 记一位星神的陨落', 's遗器 坠星启航地'],
  help: ['s角色 流萤', 's光锥 记一位星神的陨落', 's遗器 坠星启航地', 's立绘 流萤', 's行迹 流萤', 's星魂 流萤', 's晋阶 流萤', 's推荐 流萤', 's故事 流萤', 's地图 流萤', 's影音 流萤', 's表情包'],
})
