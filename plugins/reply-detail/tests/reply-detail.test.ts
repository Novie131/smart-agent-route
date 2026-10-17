import { expect, test } from 'claude-code/testing'
import { DETAIL_PROMPT, FORMAT_RULE, isLastBlock } from '../hooks/register.tsx'

test('isLastBlock：只認最後一則回答的結尾區塊', () => {
  expect(isLastBlock('結論', '前面的話\n\n結論')).toBe(true)
  expect(isLastBlock('前面的話', '前面的話\n\n結論')).toBe(false)
  expect(isLastBlock('', '結論')).toBe(false)
  expect(isLastBlock('結論', null)).toBe(false)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`最後一則回覆有按鈕，按下送出詳細說明（${surface}）`, async ($, on) => {
    const submitted: any[] = []
    on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
    on('prompt.submit', ($: any, e: any) => { submitted.push(e); return { text: e.text } })
    on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return h(Text, {}, 'engine') })
    const base = { durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' }
    await $.turn.complete({ ...base, answer: '現況：完成' } as any)
    // 子 agent 的回合不覆蓋
    await $.turn.complete({ ...base, answer: '子 agent 報告', agentId: 'a1' } as any)

    const mount = (text: string) => $.ui.mount({
      plugin: 'reply-detail', component: 'AssistantMessage', surface,
      viewport: { columns: 100, rows: 30 },
      props: { text, isFirstOfReply: true },
    } as any)

    const other = await mount('較早的一段')
    expect(await other.find({ key: 'detail' })).toBeUndefined()
    await other.unmount()

    const ui = await mount('現況：完成')
    expect(await ui.find({ key: 'detail' })).toBeDefined()
    await ui.press({ key: 'detail' })
    expect(submitted.at(-1)?.text).toBe(DETAIL_PROMPT)
    await ui.unmount()
  })
}

test('prompt.compose 注入回覆格式規則，原本的段落保留', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' }] }) as any)
  const r: any = await $.prompt.compose({ model: 'claude-opus-4-8', promptModel: 'claude-opus-4-8', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as any)
  expect(r.sections.at(-1).id).toBe('reply-detail:format')
  expect(r.sections.at(-1).text).toBe(FORMAT_RULE)
  expect(r.sections.some((s: any) => s.id === 'intro')).toBe(true)
})
