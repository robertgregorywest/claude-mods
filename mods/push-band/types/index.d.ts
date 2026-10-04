// What the branch is ahead by: `upstream` is its upstream as git names it
// (`origin/main`, `fork/feature`), the remote the push goes to.
export type Ahead = { branch: string; upstream: string; count: number; head: string; subject: string }

// The band's state; each kind but `clean` carries what it is ahead by.
export type Band =
  | { kind: 'clean' }
  | { kind: 'ahead'; ahead: Ahead }
  | { kind: 'dismissed'; ahead: Ahead }
  | { kind: 'pushing'; ahead: Ahead }
  | { kind: 'failed'; ahead: Ahead; error: string }

declare module 'claude-code' {
  interface PluginState {
    'push-band': {
      band: Band
    }
  }
}
