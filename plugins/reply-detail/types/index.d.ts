export type LastAnswer = string | null

declare module 'claude-code' {
  interface PluginState {
    'reply-detail': { lastAnswer: LastAnswer }
  }
}
