import { expect, mock, test } from 'claude-code/testing'
import {
  agentLine,
  displayWidth,
  estimateCost,
  formatCost,
  formatElapsed,
  formatTokens,
  layoutRow,
  recordUsage,
  shortModel,
  shouldAutoOpen,
  shouldStayOpen,
  showDetailButton,
  DETAIL_PROMPT,
  sortAgents,
  summarize,
  summarizeUsage,
  collapsedLabel,
  truncate,
} from '../hooks/board-logic.js'

// 共用的 stub：回答 mod 會呼叫的 mods API
function setup($: any, on: any, list: () => any[]) {
  const calls: any[] = []
  mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('agent.list', () => ({ value: list() }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: calls.filter((c) => c.t === 'open').length > calls.filter((c) => c.t === 'close').length ? [{ id: 'agent-board' }] : [] }))
  on('ui.open', ($: any, e: any) => { calls.push({ t: 'open', e }); return { value: { isPlaced: true } } })
  on('ui.close', ($: any, e: any) => { calls.push({ t: 'close', e }); return { value: undefined } })
  return calls
}

const spawnArgs = { prompt: 'x', description: 'd', subagentType: 'Explore', isBackground: true, origin: { kind: 'model' } } as any

test('agent.spawn 會開面板且不帶 focus', { options: { persistent: false } }, async ($, on) => {
  const calls = setup($, on, () => [{ id: 'a1', description: 'd', type: 'Explore', status: 'running' }])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawnArgs)
  const opens = calls.filter((c) => c.t === 'open')
  expect(opens.length).toBe(1)
  expect(opens[0].e.id).toBe('agent-board')
  expect(opens[0].e.focus).toBeUndefined()
})

test('常駐（預設）：session.start 就開面板，turn.start 不收起', async ($, on) => {
  const calls = setup($, on, () => [{ id: 'a1', description: 'd', type: 'Explore', status: 'completed' }])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(calls.map((c) => c.t)).toEqual(['open'])
  expect(calls[0].e.focus).toBeUndefined()
  await $.turn.start({ turnId: 't1' } as any)
  expect(calls.map((c) => c.t)).toEqual(['open'])
  expect(shouldStayOpen({ persistent: false })).toBe(false)
  expect(shouldStayOpen({})).toBe(true)
})

test('autoOpen=false 時不自動開（邏輯函式）', async () => {
  expect(shouldAutoOpen({ autoOpen: false })).toBe(false)
  expect(shouldAutoOpen({ autoOpen: true })).toBe(true)
  expect(shouldAutoOpen({})).toBe(true)
  expect(summarize([{ status: 'running' }, { status: 'running' }, { status: 'completed' }])).toBe('子 agent：2 執行中・1 完成')
})

test('/agent-board 開關面板', { options: { persistent: false } }, async ($, on) => {
  const calls = setup($, on, () => [])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'agent-board', args: '' })
  expect(calls.map((c) => c.t)).toEqual(['open'])
  await $.command.run({ command: 'agent-board', args: '' })
  expect(calls.map((c) => c.t)).toEqual(['open', 'close'])
})

test('turn.start 在沒有執行中 agent 時關閉面板', { options: { persistent: false } }, async ($, on) => {
  const calls = setup($, on, () => [{ id: 'a1', description: 'd', type: 'Explore', status: 'completed' }])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ turnId: 't1' } as any)
  expect(calls.map((c) => c.t)).toEqual(['close'])
})

test('turn.start 在還有執行中 agent 時不關閉', { options: { persistent: false } }, async ($, on) => {
  const calls = setup($, on, () => [{ id: 'a1', description: 'd', type: 'Explore', status: 'running' }])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ turnId: 't1' } as any)
  expect(calls.length).toBe(0)
})

const U = (i: number, o: number, cr = 0, cw = 0) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cw })
const close = (a: number | null, b: number) => expect(Math.abs((a as number) - b) < 1e-9).toBe(true)

test('estimateCost：Opus 與 Sonnet 價格（與 usage_stats.py 同值）', async () => {
  // opus: 4/20/0.20/5
  close(estimateCost(U(1_000_000, 1_000_000, 1_000_000, 1_000_000), 'claude-opus-5-5'), 4 + 20 + 0.2 + 5)
  // sonnet: 2/10/0.20/2.50，模型名用前綴比對
  close(estimateCost(U(1_000_000, 1_000_000, 1_000_000, 1_000_000), 'claude-sonnet-5-5-20261001'), 2 + 10 + 0.2 + 2.5)
})

test('estimateCost：Haiku 依 prompt 是否超過 100000 分兩段價', async () => {
  // 低價 0.10/0.50/0.01/0.125；prompt = 99000 + 1000 = 100000（剛好不超過）
  close(estimateCost(U(99000, 1000, 0, 1000), 'claude-haiku-5-5'), (99000 * 0.1 + 1000 * 0.5 + 1000 * 0.125) / 1e6)
  // 高價 0.50/2.50/0.05/0.625；prompt = 100001
  close(estimateCost(U(100001, 1000, 0, 0), 'claude-haiku-5-5'), (100001 * 0.5 + 1000 * 2.5) / 1e6)
  // cache_read 也算進 prompt
  close(estimateCost(U(10, 0, 100000, 0), 'claude-haiku-5-5'), (10 * 0.5 + 100000 * 0.05) / 1e6)
})

test('estimateCost：未知模型或缺資料回傳 null', async () => {
  expect(estimateCost(U(1, 1), 'claude-mystery-9')).toBe(null)
  expect(estimateCost(U(1, 1), undefined as any)).toBe(null)
  expect(estimateCost(null as any, 'claude-opus-5-5')).toBe(null)
})

test('formatTokens / formatElapsed / shortModel / formatCost', async () => {
  expect(formatTokens(0)).toBe('0')
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(1000)).toBe('1k')
  expect(formatTokens(12345)).toBe('12.3k')
  expect(formatTokens(999999)).toBe('1M')
  expect(formatTokens(1_234_567)).toBe('1.2M')
  expect(formatTokens(undefined as any)).toBe('—')
  expect(formatElapsed(45_000)).toBe('45s')
  expect(formatElapsed(192_000)).toBe('3m12s')
  expect(formatElapsed(60_000)).toBe('1m00s')
  expect(formatElapsed(3_900_000)).toBe('1h05m')
  expect(formatElapsed(-1)).toBe('—')
  expect(shortModel('claude-sonnet-5-5')).toBe('sonnet-5.5')
  expect(shortModel('claude-haiku-5-5-20261001')).toBe('haiku-5.5')
  expect(shortModel('claude-opus-5')).toBe('opus-5')
  expect(shortModel('sonnet')).toBe('sonnet')
  expect(shortModel(undefined as any)).toBe('—')
  expect(formatCost(0.1234)).toBe('$0.12')
  expect(formatCost(0.001)).toBe('<$0.01')
  expect(formatCost(null as any)).toBe('—')
})

test('recordUsage：沒有 agentId 或 usage 為 null 不累加；有則逐次累加', async () => {
  const m = new Map<string, any>()
  expect(recordUsage(m, undefined, U(1, 1), 'claude-opus-5-5')).toBe(false)
  expect(recordUsage(m, 'a1', null, 'claude-opus-5-5')).toBe(false)
  expect(m.size).toBe(0)
  recordUsage(m, 'a1', { ...U(100, 10, 1000, 50), model: 'claude-sonnet-5-5' }, 'x')
  recordUsage(m, 'a1', U(200, 20, 0, 0), 'claude-sonnet-5-5')
  const u = m.get('a1')
  expect([u.input, u.output, u.cacheRead, u.cacheWrite, u.steps, u.model]).toEqual([300, 30, 1000, 50, 2, 'claude-sonnet-5-5'])
  close(u.cost, (300 * 2 + 30 * 10 + 1000 * 0.2 + 50 * 2.5) / 1e6)
  recordUsage(m, 'a2', U(5, 5), 'claude-mystery')
  expect(m.get('a2').unpriced).toBe(1)
})

test('summarizeUsage / agentLine / sortAgents / layoutRow', async () => {
  const m = new Map<string, any>()
  recordUsage(m, 'a1', U(1_000_000, 0), 'claude-sonnet-5-5')
  const agents = [
    { id: 'a0', type: 'Plan', status: 'completed', description: 'x' },
    { id: 'a1', type: 'Explore', status: 'running', description: '找東西' },
  ]
  expect(summarizeUsage(agents, m)).toBe('子 agent：1 執行中・1 完成｜合計 1M tokens・約 $2.00')
  expect(summarizeUsage([], m)).toBeUndefined()
  // 縮小按鈕：列出執行中的類型，同類型合併
  const many = [
    { id: 'a1', type: 'worker', status: 'running' },
    { id: 'a2', type: 'Explore', status: 'running' },
    { id: 'a3', type: 'Explore', status: 'running' },
    { id: 'a4', type: 'bulk', status: 'completed' },
  ]
  expect(collapsedLabel(many, new Map())).toBe('執行中：worker、Explore×2｜合計 — tokens・約 —')
  expect(collapsedLabel([{ id: 'a4', type: 'bulk', status: 'completed' }], new Map())).toBe('全部完成（1 個）｜合計 — tokens・約 —')
  expect(collapsedLabel([], new Map())).toBe('目前沒有子 agent')
  expect(summarizeUsage(agents, new Map())).toBe('子 agent：1 執行中・1 完成｜合計 — tokens・約 —')
  expect(sortAgents(agents).map((a) => a.id)).toEqual(['a1', 'a0'])
  expect(agentLine(agents[1], m.get('a1'), { start: 1000, model: 'claude-sonnet-5-5' }, 46_000)).toBe('Explore｜sonnet-5.5｜執行中｜45s｜1M｜約 $2.00')
  expect(agentLine(agents[0], undefined, undefined, 0)).toBe('Plan｜—｜完成｜—｜—｜—')
  // 寬：描述接同一行；窄：第二行；太窄：省略
  expect(layoutRow('info', '描述', 100)).toEqual(['info｜描述'])
  expect(layoutRow('i'.repeat(40), '描述描述描述', 50).length).toBe(2)
  expect(layoutRow('i'.repeat(40), '描述', 25)).toEqual(['i'.repeat(40)])
  expect(displayWidth('ab中')).toBe(4)
  expect(truncate('中文中文中文', 7)).toBe('中文中…')
})

// 驅動 turn.step 串流到結束，回傳最終結果
async function runStep($: any, input: any) {
  const stream = $.turn.step(input)
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  return step.value
}

function stepStub(on: any, usage: any) {
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage }
  })
}

test('turn.step：有 agentId 才累加，面板顯示合計；結果原樣回傳', async ($, on) => {
  mock.clock(on)
  stepStub(on, { ...U(1000, 500, 2000, 100), model: 'claude-sonnet-5-5' })
  on('agent.list', () => ({ value: [{ id: 'a1', description: '找檔案', type: 'Explore', status: 'running' }] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.agent.spawn(spawnArgs)

  // 主對話請求：不記錄，結果原樣
  const main = await runStep($, { turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })
  expect(main.answer).toBe('ok')
  // 子 agent 請求：記錄
  const sub = await runStep($, { turnId: 't', index: 1, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' })
  expect(sub.usage.input_tokens).toBe(1000)

  const ui = await $.ui.mount({
    plugin: 'agent-board', component: 'Pane', requestId: 'agent-board', surface: 'terminal',
    viewport: { columns: 100, rows: 30 },
    props: { title: '子 agent', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} },
  } as any)
  // 3600 tokens；金額 (1000*2 + 500*10 + 2000*0.2 + 100*2.5)/1e6 = 0.00765 → 顯示 <$0.01
  expect(await ui.find({ type: 'Text', text: /合計 3\.6k tokens・約 <\$0\.01/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore｜sonnet-5\.5｜執行中/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /估計（API 牌價）/ })).toBeDefined()
  // 縮小：只剩一顆帶摘要的按鈕；再按一次展開
  await ui.press({ key: 'collapse' })
  expect(await ui.find({ key: 'expand' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore｜sonnet-5\.5/ })).toBeUndefined()
  await ui.press({ key: 'expand' })
  expect(await ui.find({ key: 'collapse' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore｜sonnet-5\.5｜執行中/ })).toBeDefined()
  await ui.unmount()
})

test('turn.step：usage 為 null 不出錯，結果原樣', async ($, on) => {
  stepStub(on, null)
  const r = await runStep($, { turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' })
  expect(r.usage).toBe(null)
  expect(r.answer).toBe('ok')
})

test('看板的「▸ 詳細說明」按鈕會代使用者送出詳細說明訊息', async ($, on) => {
  setup($, on, () => [])
  const submitted: any[] = []
  on('prompt.submit', ($: any, e: any) => { submitted.push(e); return { text: e.text } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({
    plugin: 'agent-board', component: 'Pane', requestId: 'agent-board', surface: 'terminal',
    viewport: { columns: 100, rows: 30 },
    props: { title: '子 agent', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} },
  } as any)
  await ui.press({ key: 'detail' })
  expect(submitted.at(-1)?.text).toBe(DETAIL_PROMPT)
  expect(submitted.at(-1)?.origin?.asUser).toBe(true)
  // 縮小後按鈕仍在
  await ui.press({ key: 'collapse' })
  expect(await ui.find({ key: 'detail' })).toBeDefined()
  await ui.unmount()
  expect(showDetailButton({ detailButton: false })).toBe(false)
  expect(showDetailButton({})).toBe(true)
})
