import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getWikiConfig, saveWikiConfig } from './config/config.js'

const pluginRoot = path.dirname(fileURLToPath(import.meta.url))
const backgroundDir = path.join(pluginRoot, 'resources', 'background')

const options = items => items.map(([label, value]) => ({ label, value }))

function uploadedPath(value) {
  const item = Array.isArray(value) ? value[0] : value
  if (!item) return ''
  if (typeof item === 'string') return item
  return item.path || item.url || item.response?.url || item.name || ''
}

function saveBackground(value) {
  const source = uploadedPath(value)
  if (!source || /^https?:\/\//i.test(source)) return source
  const file = source.replace(/^file:\/\//, '')
  if (!fs.existsSync(file)) return ''
  fs.mkdirSync(backgroundDir, { recursive: true })
  const target = path.join(backgroundDir, `help${path.extname(file) || '.png'}`)
  if (path.resolve(file) !== path.resolve(target)) fs.copyFileSync(file, target)
  return path.relative(pluginRoot, target).replace(/\\/g, '/')
}

export function supportGuoba() {
  return {
    pluginInfo: {
      name: 'genshin-codex',
      title: '观测枢图鉴',
      author: 'wubaojun',
      authorLink: 'https://gitee.com/wubaojun',
      link: 'https://gitee.com/wubaojun/genshin-codex',
      isV3: true,
      isV2: false,
      showInMenu: 'auto',
      description: '原神、星穹铁道、绝区零图鉴',
      icon: 'mdi:book-open-page-variant',
      iconColor: '#d3bc8e',
      iconPath: path.join(backgroundDir, 'bg.png'),
    },
    configInfo: {
      schemas: [
        { label: '帮助外观', component: 'SOFT_GROUP_BEGIN' },
        {
          field: 'theme', label: '帮助主题', component: 'Select',
          componentProps: { options: options([['喵喵深色', 'miao'], ['浅色卡片', 'light'], ['透明毛玻璃', 'glass']]) },
        },
        {
          field: 'columns', label: '每行列数', component: 'Select',
          componentProps: { options: options([['两列', 2], ['三列', 3], ['四列', 4]]) },
        },
        {
          field: 'fontFamily', label: '字体', component: 'Select',
          componentProps: { options: options([['微软雅黑', 'Microsoft YaHei'], ['黑体', 'SimHei'], ['宋体', 'SimSun'], ['楷体', 'KaiTi'], ['苹方', 'PingFang SC']]) },
        },
        { field: 'glass', label: '毛玻璃', component: 'Switch' },
        { field: 'containerOpacity', label: '透明度', component: 'Slider', componentProps: { min: 0, max: 1, step: 0.01 } },
        { field: 'blur', label: '模糊程度', component: 'Slider', componentProps: { min: 0, max: 30 } },
        { label: '颜色', component: 'SOFT_GROUP_BEGIN' },
        { field: 'titleColor', label: '标题颜色', component: 'ColorPicker' },
        { field: 'commandColor', label: '指令颜色', component: 'ColorPicker' },
        { field: 'textColor', label: '说明颜色', component: 'ColorPicker' },
        { label: '帮助内容', component: 'SOFT_GROUP_BEGIN' },
        {
          field: 'helpGroups', label: '帮助分组', bottomHelpMessage: '可直接增删分组和指令。普通用户只显示勾选了常用的分组',
          component: 'GSubForm',
          componentProps: {
            multiple: true,
            schemas: [
              { field: 'group', label: '分组名称', component: 'Input', required: true },
              { field: 'common', label: '普通用户可见', component: 'Switch' },
              {
                field: 'list', label: '指令列表', component: 'GSubForm',
                componentProps: {
                  multiple: true,
                  schemas: [
                    { field: 'title', label: '指令', component: 'Input', required: true },
                    { field: 'desc', label: '说明', component: 'Input', required: true },
                  ],
                },
              },
            ],
          },
        },
        { label: '背景图', component: 'SOFT_GROUP_BEGIN' },
        { field: 'backgroundPath', label: '当前背景', component: 'Input', componentProps: { disabled: true } },
        {
          field: 'backgroundUpload', label: '上传背景图', bottomHelpMessage: '选择图片后点击保存，下一次帮助会使用新背景',
          component: 'InputUpload', componentProps: { maxCount: 1, accept: 'image/*' },
        },
      ],
      getConfigData() {
        return { ...getWikiConfig(), backgroundUpload: [] }
      },
      setConfigData(data, { Result }) {
        const next = { ...getWikiConfig(), ...data }
        const background = saveBackground(data.backgroundUpload)
        if (background) next.backgroundPath = background
        delete next.backgroundUpload
        saveWikiConfig(next)
        return Result.ok({}, '帮助样式已保存')
      },
    },
  }
}
