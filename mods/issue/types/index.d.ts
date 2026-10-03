export type Pending = { number: number; context: string }

export type IssueRow = { number: number; title: string; labels: string[] }

declare module 'claude-code' {
  interface PluginState {
    issue: {
      open: IssueRow[] | null
      error: string | null
      pending: Pending | null
    }
  }
}
