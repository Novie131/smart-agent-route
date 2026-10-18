import type { Register } from 'claude-code'

// 不接手畫回覆訊息：mod 一畫 AssistantMessage，VS Code 就會加外框和「From the reply-detail plugin」標籤，
// 而且 mod 關不掉。「▸ 詳細說明」按鈕與回覆模式切換鍵改放在 agent-board 看板；也可以直接輸入「詳細說明」。
export const FORMAT_RULE = `# 回覆格式（reply-detail plugin）
本段只適用於直接回覆使用者的主對話；如果你是子 agent，忽略本段，照你自己的回報格式。
- 每一輪結束的回覆預設是精簡版，讓使用者一眼看懂，固定三段（某段沒有內容就寫「無」）：
  - **現況**：一到三句，做到哪、結果如何、驗證有沒有過
  - **你要做的**：需要使用者動手的事，附可直接複製的指令
  - **需要你決定／提供**：問題附推薦答案；要使用者提供的資訊說清楚是什麼
- 過程、證據、檔案清單、取捨分析不放精簡版；工作途中的進度更新維持一句話
- 使用者送出「詳細說明」開頭的訊息（或按看板上的「▸ 詳細說明」按鈕）時，把上一則回覆改寫成詳細版：背景、做了什麼、證據與檔案位置、取捨與風險；不重做工作，只展開說明
- 使用者訊息附有「回覆模式：詳細」時（看板上的切換鍵），那一輪結束的回覆直接寫詳細版，不用三段式`

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { ...r, sections: [...r.sections, { id: 'reply-detail:format', text: FORMAT_RULE, scope: 'session' }] }
  })
}
