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
  return `<!doctype html><html><head><meta charset="UTF-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e8eef5}</style></head><body><script>location.replace(${encoded})</script></body></html>`
}
