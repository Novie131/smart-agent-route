import { expect, test } from 'claude-code/testing'
import { FORMAT_RULE } from '../hooks/register.tsx'

test('prompt.compose 注入回覆格式規則，原本的段落保留', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' }] }) as any)
  const r: any = await $.prompt.compose({ model: 'claude-opus-4-8', promptModel: 'claude-opus-4-8', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as any)
  expect(r.sections.at(-1).id).toBe('reply-detail:format')
  expect(r.sections.at(-1).text).toBe(FORMAT_RULE)
  expect(r.sections.some((s: any) => s.id === 'intro')).toBe(true)
})

test('規則限定主對話，並說明詳細說明的觸發方式', () => {
  expect(FORMAT_RULE).toContain('如果你是子 agent，忽略本段')
  expect(FORMAT_RULE).toContain('「詳細說明」開頭的訊息')
})
