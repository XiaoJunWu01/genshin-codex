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
  const matched = list.filter(item => item.name.toLowerCase().includes(text))
  return (matched.length ? matched : list.filter(item => /采集|收集|路线/.test(item.name))).slice(0, 8)
}

export function mapRouteHtml(route) {
  const src = String(route?.url || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<!doctype html><html><head><meta charset="UTF-8"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e8eef5}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe src="${src}" allow="fullscreen"></iframe><script>setTimeout(()=>document.documentElement.classList.add('ready'),1200)</script></body></html>`
}
