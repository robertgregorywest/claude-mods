export type Ahead = { branch: string; count: number; head: string; subject: string }

declare module 'claude-code' {
  interface PluginState {
    'push-band': {
      ahead: Ahead | null
      dismissedHead: string | null
      isPushing: boolean
      error: string | null
    }
  }
}
