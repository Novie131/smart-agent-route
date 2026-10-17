import {
  agentLine,
  countActive,
  isActive,
  layoutRow,
  recordUsage,
  shouldAutoOpen,
  shouldStayOpen,
  showDetailButton,
  DETAIL_PROMPT,
  sortAgents,
  summarizeUsage,
  collapsedLabel,
} from './board-logic.js'

const PANE = 'agent-board'

// 計時器與快取在模組層級；reload 時 register 會重跑，狀態會歸零
let timer = null
let agents = []
let nowMs = 0
// 面板縮小時只畫一顆按鈕；記住使用者的選擇，自動開啟時沿用
let collapsed = false
// 依 agentId 累計的 token／金額（來自 turn.step 的 usage）
const usageByAgent = new Map()
// 依 agentId 記開始／結束時間與 spawn 解析後的模型：{ start, end, model }
const metaByAgent = new Map()
// 使用者用 /agent-board 關掉後，常駐模式就不再自動重開，直到再用 /agent-board 打開
let userClosed = false

// 面板要真的放上畫面才算開著：$.ui.panes() 也會列出等待放置（isPlaced: false）的面板
async function isShown($) {
  const panes = await $.ui.panes()
  return panes.some((p) => p.id === PANE && p.isPlaced !== false)
}

// 常駐模式：面板不在畫面上就重開。
// 引擎對非使用者觸發的 ui.open 有寬度門檻（沒手動開過要 144 欄、開過要 110 欄），
// VS Code 的聊天面板常常不夠寬，session.start 開的面板就停在未放置；
// 畫面重連、寬度改變、回合開始與結束時都檢查一次，其中 turn.start 由使用者送出訊息觸發，不受門檻限制
async function ensureOpen($, options) {
  if (!shouldStayOpen(options) || userClosed) return
  try {
    if (!(await isShown($))) await $.ui.open({ id: PANE, title: '子 agent' })
  } catch (err) {
    $.ui.log('agent-board：' + err.message, { to: 'debug' })
  }
}

// 重新讀 agent 清單、更新狀態列；有進行中的 agent 就確保計時器在跑，沒有就停掉
async function refresh($) {
  agents = await $.agent.list()
  nowMs = await $.clock.now()
  // 第一次看到不再進行中的 agent 時記下結束時間，之後經過時間就不再增加
  for (const a of agents) {
    const m = metaByAgent.get(a.id)
    if (m && m.end === undefined && !isActive(a)) m.end = nowMs
  }
  // 狀態列附上開啟方式：面板關掉後沒有按鈕能再打開，只能靠 /agent-board
  const line = summarizeUsage(agents, usageByAgent)
  $.ui.status(line && line + '・/agent-board 開關')
  $.ui.invalidate('ui.render')
  if (countActive(agents) > 0) {
    if (timer === null) {
      timer = $.clock.every(1000, () => refresh($))
    }
  } else if (timer !== null) {
    timer.cancel()
    timer = null
  }
}

export function register(on, options) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-board',
      description: '開關子 agent 狀態看板',
      // 子 agent 在跑時主對話的 turn 通常還沒結束，不設 immediate 會等到 turn 結束才開
      immediate: true,
    })
    // 常駐模式：一開始就開面板（不帶 focus），沒有子 agent 時顯示「目前沒有子 agent」
    await ensureOpen($, options)
    return next(e)
  })

  // 畫面（VS Code webview、終端機）連上或寬度改變時，補開沒放上畫面的面板
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    await ensureOpen($, options)
    return result
  })
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await ensureOpen($, options)
    return result
  })

  // 子 agent 即將啟動：先開面板（不帶 focus）再交出事件，
  // 因為文件沒寫 next 是在 agent 開始還是結束時返回，先開才保證是即時的
  on('agent.spawn', async ($, e, next) => {
    // 看板出錯不能影響子 agent 本身的啟動
    try {
      if (shouldAutoOpen(options)) {
        await $.ui.open({ id: PANE, title: '子 agent' })
      }
    } catch (err) {
      $.ui.log('agent-board：' + err.message, { to: 'debug' })
    }
    let startMs
    try {
      startMs = await $.clock.now()
    } catch (err) {
      $.ui.log('agent-board：' + err.message, { to: 'debug' })
    }
    const result = await next(e)
    try {
      if (result && result.agentId) {
        metaByAgent.set(result.agentId, { start: startMs, end: undefined, model: result.model })
      }
      await refresh($)
      // agent 可能還沒出現在清單上，稍後補一次，避免計時器因「沒有進行中」而停掉
      $.clock.after(1500, () => refresh($))
    } catch (err) {
      $.ui.log('agent-board：' + err.message, { to: 'debug' })
    }
    return result
  })

  // 子 agent 的每次模型請求：完成後把 usage 累加起來。主對話（沒有 agentId）直接放行。
  // 記錄出錯不能影響請求，結果一定原樣回傳。只讀 usage，不呼叫模型、不寫對話紀錄。
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      if (e.agentId && recordUsage(usageByAgent, e.agentId, result && result.usage, e.model)) {
        $.ui.invalidate('ui.render')
      }
    } catch (err) {
      // 不能讓看板的錯誤影響請求
    }
    return result
  })

  // 使用者送出下一則訊息時，若沒有進行中的 agent 就收起面板（常駐模式不收）
  on('turn.start', async ($, e, next) => {
    if (shouldStayOpen(options)) {
      await ensureOpen($, options)
      return next(e)
    }
    agents = await $.agent.list()
    if (countActive(agents) === 0) {
      await $.ui.close({ id: PANE })
    }
    return next(e)
  })

  // 回合結束時再檢查一次（例如回合中途畫面重連過）
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await ensureOpen($, options)
    return result
  })

  // /agent-board：開關面板，自己處理完不呼叫 next。
  // 用 isPlaced 判斷：看不見的面板也在清單裡，只看 id 會把它當成開著而關掉
  on('command.run', { command: 'agent-board' }, async ($) => {
    if (await isShown($)) {
      userClosed = true
      await $.ui.close({ id: PANE })
    } else {
      userClosed = false
      await $.ui.open({ id: PANE, title: '子 agent', closeOnEscape: true })
      await refresh($)
    }
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)

    const summary = summarizeUsage(agents, usageByAgent) || '目前沒有子 agent'
    const toggle = () => {
      collapsed = !collapsed
      $.ui.invalidate('ui.render')
    }
    // 底部按鈕列：縮小／展開，加上可關掉的「▸ 詳細說明」
    const detail = showDetailButton(options)
      ? [Button({ key: 'detail', label: '▸ 詳細說明', onPress: () => $.prompt.submit({ text: DETAIL_PROMPT, asUser: true }) })]
      : []
    const buttonRow = (first) => Box({ flexDirection: 'row', gap: 1, children: [first, ...detail] })
    if (collapsed) {
      return Box({
        flexDirection: 'column',
        children: [buttonRow(Button({ key: 'expand', label: '▸ ' + collapsedLabel(agents, usageByAgent), onPress: toggle }))],
      })
    }

    const columns = e.props && e.props.bodyColumns
    const rows = sortAgents(agents).flatMap((a) =>
      layoutRow(
        agentLine(a, usageByAgent.get(a.id), metaByAgent.get(a.id), nowMs),
        a.description,
        columns
      ).map((line, i) =>
        Text({ key: 'row-' + a.id + '-' + i, dimColor: i > 0, children: [line] })
      )
    )

    return Box({
      flexDirection: 'column',
      children: [
        Text({ bold: true, children: [summary] }),
        ...rows,
        Text({ dimColor: true, children: ['金額為估計（API 牌價）'] }),
        buttonRow(Button({ key: 'collapse', label: '▾ 縮小', onPress: toggle })),
      ],
    })
  })
}
