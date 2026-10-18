const MAP_BASE = 'https://waf-api-takumi.mihoyo.com/common/map_user/ys_obc'
const MAP_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
  referer: 'https://act.mihoyo.com/ys/app/interactive-map/',
  origin: 'https://act.mihoyo.com',
  'x-rpc-map_version': '4.5',
}

const fetchCompat = (...args) => typeof globalThis.fetch === 'function'
  ? globalThis.fetch(...args)
  : import('node-fetch').then(mod => mod.default(...args))

function decode(value) {
  try { return decodeURIComponent(String(value || '')) } catch { return String(value || '') }
}

async function request(path, params = {}) {
  const query = new URLSearchParams({ ...params, app_sn: 'ys_obc', lang: 'zh-cn' })
  const res = await fetchCompat(`${MAP_BASE}${path}?${query}`, { headers: MAP_HEADERS })
  if (!res.ok) throw new Error(`互动地图请求失败: ${res.status}`)
  const json = await res.json()
  if (json?.retcode !== 0) throw new Error(json?.message || '互动地图返回异常')
  return json.data
}

export async function recommendedRoutes(keyword = '') {
  const data = await request('/v1/map/get_recommend_path', { map_id: 2 })
  const text = String(keyword || '').trim().toLowerCase()
  const list = (data?.list || []).map(item => ({
    id: item.id,
    name: decode(item.name),
    url: item.url || '',
    labelId: item.main_label_id || 0,
  })).filter(item => item.url && item.name)
  if (!text) return list.slice(0, 8)
  const aliases = { '霓虹花': '霓裳花' }
  const terms = [text, aliases[text] || ''].filter(Boolean)
  return list.filter(item => terms.some(term => item.name.toLowerCase().includes(term))).slice(0, 8)
}

export function mapRouteHtml(route) {
  const src = String(route?.url || '')
  const encoded = JSON.stringify(src)
  return `<!doctype html><html><head><meta charset="UTF-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e8eef5}
/* 米游社登录/分享弹窗，保留地图本体 */
[class*="login"],[class*="Login"],[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"],[class*="popup"],[class*="Popup"],[class*="mask"],[class*="Mask"],[role="dialog"],[aria-modal="true"]{display:none!important;visibility:hidden!important}
</style></head><body><script>
location.replace(${encoded})
setTimeout(()=>{
  const words=/登录|手机号|验证码|账号密码|同意并登录|立即登录|登录后查看/
  const hide=()=>{
    for(const root of [document,...document.querySelectorAll('*')]){
      const nodes=root.querySelectorAll?.('*')||[]
      for(const node of nodes){
        const style=getComputedStyle(node), rect=node.getBoundingClientRect(), text=(node.innerText||'').trim()
        if((style.position==='fixed'||style.position==='absolute') && rect.width>240 && rect.height>120 && rect.width<window.innerWidth*.95 && rect.height<window.innerHeight*.95 && (words.test(text)||Number(style.zIndex||0)>1000)) node.remove()
      }
    }
  }
  hide(); new MutationObserver(hide).observe(document.documentElement,{subtree:true,childList:true,attributes:true})
},3000)
</script></body></html>`
}
