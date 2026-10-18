// 純函式：不碰 $，方便單獨測試

// 這些狀態算「還在進行中」
const ACTIVE = ['pending', 'running', 'waiting']

export function isActive(agent) {
  return ACTIVE.includes(agent.status)
}

export function countActive(agents) {
  return agents.filter(isActive).length
}

// options.autoOpen 預設 true；只有明確設成 false 才不自動開
export function shouldAutoOpen(options) {
  return !options || options.autoOpen !== false
}

// options.detailButton 預設 true：看板底部顯示回覆模式切換鍵（設定名稱沿用舊版，避免已設定的人失效）
export function showDetailButton(options) {
  return !options || options.detailButton !== false
}

// 回覆模式切到「詳細」時，附在每則使用者訊息後面的要求（prompt.submit 的 context，每輪都會送出）。
// 不用 prompt.compose：2.1.301 實測 session 段落只在第一輪生效，之後改了也不會送出
export const DETAIL_MODE_CONTEXT =
  '回覆模式：詳細（使用者在看板切換）：這一輪結束的回覆不用精簡版三段式，直接寫詳細版：背景、做了什麼、證據與檔案位置、取捨與風險。'

// 看板上回覆模式切換鍵的文字：顯示目前模式，按下切到另一個
export function replyModeLabel(mode) {
  return mode === 'detail' ? '⇄ 回覆：詳細' : '⇄ 回覆：精簡'
}

// options.persistent 預設 true：session 開始就開面板，turn.start 不收起
export function shouldStayOpen(options) {
  return !options || options.persistent !== false
}

// 狀態列一行摘要，例如「子 agent：2 執行中・1 完成」
export function summarize(agents) {
  const active = countActive(agents)
  const done = agents.filter((a) => a.status === 'completed').length
  const failed = agents.filter((a) => a.status === 'failed' || a.status === 'killed').length
  const parts = []
  if (active > 0) parts.push(active + ' 執行中')
  if (done > 0) parts.push(done + ' 完成')
  if (failed > 0) parts.push(failed + ' 失敗')
  return parts.length > 0 ? '子 agent：' + parts.join('・') : undefined
}

const STATUS_LABEL = {
  pending: '等待中',
  running: '執行中',
  waiting: '等待輸入',
  idle: '閒置',
  completed: '完成',
  failed: '失敗',
  killed: '已終止',
}

export function statusLabel(status) {
  return STATUS_LABEL[status] || status
}

// ---- 用量、金額與顯示格式 ----

// 價格表：每百萬 token 美元，與 skills/usage-stats/usage_stats.py 的 PRICES 同值（該檔在別的外掛，不 import）。
// 欄位順序：[input, output, cache read, 5 分鐘寫入]。模型名用前綴比對。
const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
}
// Haiku 依該次請求的 prompt（input+cache_read+cache_write）分兩段價
const HAIKU_PREFIX = 'claude-haiku-5-5'
const HAIKU_LOW = [0.1, 0.5, 0.01, 0.125]
const HAIKU_HIGH = [0.5, 2.5, 0.05, 0.625]
const HAIKU_LIMIT = 100000

function n(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

// 單次請求的估計金額（美元）；模型不認得回傳 null。
// 估計值：TurnUsage 沒有分 5 分鐘／1 小時寫入，cache_write 一律用 5 分鐘寫入價（1 小時寫入實際較貴）。
export function estimateCost(usage, model) {
  if (!usage || typeof model !== 'string') return null
  const inp = n(usage.input_tokens)
  const out = n(usage.output_tokens)
  const cr = n(usage.cache_read_input_tokens)
  const cw = n(usage.cache_creation_input_tokens)
  let price = null
  if (model.startsWith(HAIKU_PREFIX)) {
    price = inp + cr + cw <= HAIKU_LIMIT ? HAIKU_LOW : HAIKU_HIGH
  } else {
    for (const prefix of Object.keys(PRICES)) {
      if (model.startsWith(prefix)) {
        price = PRICES[prefix]
        break
      }
    }
  }
  if (price === null) return null
  return (inp * price[0] + out * price[1] + cr * price[2] + cw * price[3]) / 1_000_000
}

export function newUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 0, model: null, cost: 0, unpriced: 0 }
}

// 把一次 turn.step 的 usage 累加進 map（依 agentId）。沒有 agentId 或 usage 為 null 不動作，回傳是否有記錄。
// 金額逐次請求計算再加總（Haiku 兩段價是看單次請求，不能用累計值算）。
export function recordUsage(map, agentId, usage, fallbackModel) {
  if (!agentId || !usage || typeof usage !== 'object') return false
  const u = map.get(agentId) || newUsage()
  const model = typeof usage.model === 'string' && usage.model ? usage.model : fallbackModel
  u.input += n(usage.input_tokens)
  u.output += n(usage.output_tokens)
  u.cacheRead += n(usage.cache_read_input_tokens)
  u.cacheWrite += n(usage.cache_creation_input_tokens)
  u.steps += 1
  if (typeof model === 'string' && model) u.model = model
  const c = estimateCost(usage, model)
  if (c === null) u.unpriced += 1
  else u.cost += c
  map.set(agentId, u)
  return true
}

export function totalTokens(u) {
  return u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0
}

// 12.3k、1.2M；整數不帶 .0
export function formatTokens(count) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return '—'
  if (count < 1000) return String(Math.round(count))
  const trim = (x) => x.toFixed(1).replace(/\.0$/, '')
  if (count < 999950) return trim(count / 1000) + 'k'
  return trim(count / 1e6) + 'M'
}

// 45s、3m12s、1h05m
export function formatElapsed(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0') + 's'
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm'
}

// claude-sonnet-5-5 → sonnet-5.5；去掉日期尾碼；認不得的原樣回傳；沒有值回傳 '—'
export function shortModel(model) {
  if (typeof model !== 'string' || !model) return '—'
  const m = model.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/)
  if (m) return m[1] + '-' + m[2] + (m[3] ? '.' + m[3] : '')
  return model.replace(/^claude-/, '')
}

// 「約 $0.12」用的數字；null 回傳 '—'
export function formatCost(usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return '—'
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return '$' + usd.toFixed(2)
}

// 顯示寬度：全形／CJK 算 2 欄
function charWidth(ch) {
  const c = ch.codePointAt(0)
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff)
    ? 2
    : 1
}

export function displayWidth(str) {
  let w = 0
  for (const ch of String(str)) w += charWidth(ch)
  return w
}

// 依顯示寬度截斷，超過加「…」；也會把換行壓成空白
export function truncate(str, width) {
  const s = String(str ?? '').replace(/\s+/g, ' ').trim()
  if (displayWidth(s) <= width) return s
  let w = 0
  let out = ''
  for (const ch of s) {
    const cw = charWidth(ch)
    if (w + cw > width - 1) break
    out += ch
    w += cw
  }
  return out + '…'
}

function sums(agents, usageMap) {
  let tokens = 0
  let cost = 0
  let unpriced = 0
  let seen = false
  for (const a of agents) {
    const u = usageMap.get(a.id)
    if (!u) continue
    seen = true
    tokens += totalTokens(u)
    cost += u.cost
    unpriced += u.unpriced
  }
  return { tokens, cost, unpriced, seen }
}

// 「N 執行中・M 完成｜合計 X tokens・約 $Y」；用於面板第一行與狀態列（最多 200 字）
export function summarizeUsage(agents, usageMap) {
  const base = summarize(agents)
  if (!base) return undefined
  return withUsageTail(base, agents, usageMap)
}

// 縮小時的按鈕文字：列出執行中的類型（同類型合併成 ×N），看得出是誰在跑
export function collapsedLabel(agents, usageMap) {
  if (agents.length === 0) return '目前沒有子 agent'
  const active = agents.filter(isActive)
  if (active.length === 0) return withUsageTail('全部完成（' + agents.length + ' 個）', agents, usageMap)
  const counts = new Map()
  for (const a of active) counts.set(a.type || '—', (counts.get(a.type || '—') || 0) + 1)
  const types = [...counts].map(([t, n]) => (n > 1 ? t + '×' + n : t)).join('、')
  return withUsageTail('執行中：' + types, agents, usageMap)
}

function withUsageTail(head, agents, usageMap) {
  const s = sums(agents, usageMap)
  const cost = s.seen ? formatCost(s.cost) + (s.unpriced > 0 ? '+' : '') : '—'
  const text = head + '｜合計 ' + (s.seen ? formatTokens(s.tokens) : '—') + ' tokens・約 ' + cost
  return text.length > 200 ? text.slice(0, 199) + '…' : text
}

// 執行中的排前面，其餘維持原順序
export function sortAgents(agents) {
  return [...agents].sort((a, b) => Number(isActive(b)) - Number(isActive(a)))
}

// 一個 agent 的資訊行（不含描述）。meta：{ start, end, model }
export function agentLine(agent, usage, meta, now) {
  const m = meta || {}
  let elapsed = '—'
  if (typeof m.start === 'number') {
    const end = typeof m.end === 'number' ? m.end : isActive(agent) ? now : undefined
    if (typeof end === 'number') elapsed = formatElapsed(end - m.start)
  }
  const model = (usage && usage.model) || m.model
  const tokens = usage ? formatTokens(totalTokens(usage)) : '—'
  const cost = usage && usage.steps > 0 ? (usage.unpriced > 0 && usage.cost === 0 ? '—' : '約 ' + formatCost(usage.cost)) : '—'
  return [agent.type || '—', shortModel(model), statusLabel(agent.status), elapsed, tokens, cost].join('｜')
}

// 依寬度排版：寬就把描述接在同一行，窄就放第二行（太窄則省略）。回傳字串陣列。
export function layoutRow(info, description, columns) {
  const cols = typeof columns === 'number' && columns > 0 ? columns : 60
  const desc = String(description ?? '').trim()
  if (!desc) return [info]
  const room = cols - displayWidth(info) - 1
  if (room >= 20) return [info + '｜' + truncate(desc, room - 1)]
  if (cols < 30) return [info]
  return [info, '  ' + truncate(desc, cols - 2)]
}
