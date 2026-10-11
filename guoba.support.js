import path from 'path'
import { fileURLToPath } from 'url'
import { getWikiConfig, saveWikiConfig } from './config/config.js'

const pluginRoot = path.dirname(fileURLToPath(import.meta.url))

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
      description: '原神、星穹铁道、绝区零图鉴',
      icon: 'mdi:book-open-page-variant',
      iconColor: '#d3bc8e',
      iconPath: path.join(pluginRoot, 'resources/background/bg.png'),
    },
    configInfo: {
      schemas: [
        { field: 'backgroundPath', label: '帮助背景图', bottomHelpMessage: '插件内相对路径、本地绝对路径或图片网址', component: 'Input' },
        { field: 'containerOpacity', label: '毛玻璃透明度', bottomHelpMessage: '0 到 1，越小越透明', component: 'InputNumber', componentProps: { min: 0, max: 1, step: 0.01 } },
        { field: 'blur', label: '毛玻璃模糊', bottomHelpMessage: '0 到 30', component: 'InputNumber', componentProps: { min: 0, max: 30 } },
        { field: 'titleColor', label: '标题颜色', component: 'Input', componentProps: { placeholder: '#ffffff' } },
        { field: 'commandColor', label: '指令颜色', component: 'Input', componentProps: { placeholder: '#fff3cf' } },
        { field: 'textColor', label: '说明文字颜色', component: 'Input', componentProps: { placeholder: '#ffffff' } },
        { field: 'fontFamily', label: '字体', bottomHelpMessage: '服务器已安装的字体名称', component: 'Input' },
      ],
      getConfigData: getWikiConfig,
      setConfigData: (_, config) => saveWikiConfig(config),
    },
  }
}
