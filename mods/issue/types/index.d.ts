export type Staged = { number: number; context: string }

export type IssueRow = { number: number; title: string; labels: string[] }

declare module 'claude-code' {
  interface PluginState {
    issue: {
      open: IssueRow[] | null
      error: string | null
      staged: Staged | null
    }
  }
}
