const POST_API = 'https://bbs-api.miyoushe.com/painter/wapi/userPostList'
const BLOGGER_UID = '283146979'
const POST_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
  referer: 'https://www.miyoushe.com/ys/accountCenter/postList?id=283146979',
  origin: 'https://www.miyoushe.com',
}

const fetchCompat = (...args) => typeof globalThis.fetch === 'function'
  ? globalThis.fetch(...args)
  : import('node-fetch').then(mod => mod.default(...args))

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function embeddedText(value, images = []) {
  if (Array.isArray(value)) return value.map(item => embeddedText(item, images)).join(' ')
  if (!value || typeof value !== 'object') return String(value || '')
  if (typeof value.insert === 'string') return value.insert
  if (value.insert?.image) images.push(String(value.insert.image))
  return embeddedText(value.insert, images)
}

function imageUrls(post, deltaImages) {
  const list = Array.isArray(post.image_list) ? post.image_list.map(item => item?.url || item) : []
  const fallback = Array.isArray(post.images) ? post.images : []
  return [...new Set([...deltaImages, ...list, ...fallback]
    .map(item => typeof item === 'string' ? item : item?.url)
    .filter(url => /^https?:\/\//i.test(String(url || ''))))]
}

function postFrom(item) {
  const post = item?.post || item || {}
  const id = String(post.post_id || item?.post_id || '')
  const deltaImages = []
  let structuredText = ''
  try { structuredText = embeddedText(JSON.parse(post.structured_content || '[]'), deltaImages) } catch {}
  const content = [post.content, post.text_summary, structuredText].filter(Boolean).join(' ')
  return {
    id,
    title: String(post.subject || post.title || '路线帖子').trim(),
    content,
    images: imageUrls({ ...post, image_list: item?.image_list || post.image_list }, deltaImages),
    url: id ? `https://www.miyoushe.com/ys/article/${id}` : '',
  }
}

async function request(params = {}) {
  const query = new URLSearchParams({ uid: BLOGGER_UID, gids: '2', size: '20', last_id: '0', ...params })
  const res = await fetchCompat(`${POST_API}?${query}`, { headers: POST_HEADERS })
  if (!res.ok) throw new Error(`米游社帖子请求失败: ${res.status}`)
  const json = await res.json()
  if (json?.retcode && json.retcode !== 0) throw new Error(json.message || '米游社帖子返回异常')
  return json.data || {}
}

/** Fetch and keyword-filter public route posts from the configured MiYouShe blogger. */
export async function recommendedRoutes(keyword = '') {
  const text = normalize(keyword)
  if (!text) return []
  const aliases = { '霓虹花': '霓裳花', '霓裳花': '霓虹花' }
  const terms = [text, aliases[text]].filter(Boolean)
  const found = []
  const seen = new Set()
  let lastId = '0'
  for (let page = 0; page < 3 && found.length < 8; page++) {
    const data = await request({ last_id: lastId })
    const list = data.list || data.posts || []
    for (const item of list) {
      const post = postFrom(item)
      if (!post.id || seen.has(post.id)) continue
      seen.add(post.id)
      if (terms.some(term => normalize(`${post.title} ${post.content}`).includes(normalize(term)))) found.push(post)
    }
    if (data.is_last === true || !list.length) break
    const next = String(data.next_offset || data.last_id || data.next_last_id || '')
    if (!next || next === '0' || next === lastId) break
    lastId = next
  }
  return found.slice(0, 8)
}

export function postImageUrls(post, limit = 8) {
  return (post?.images || []).slice(0, limit)
}

export function routePostUrl(post) {
  return post?.url || ''
}
