import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ahead, Band } from '../types'

const git = async ($: EngineInterface, ...args: string[]) => {
  const { exitCode, stdout, stderr } = await $.process.run(['git', ...args], {
    env: { GIT_TERMINAL_PROMPT: '0' },
    timeoutMs: args[0] === 'push' ? 120_000 : 10_000,
  })

  return { ok: exitCode === 0, out: stdout.trim(), err: stderr.trim() }
}

const findAhead = async ($: EngineInterface): Promise<Ahead | null> => {
  const branch = await git($, 'rev-parse', '--abbrev-ref', 'HEAD')
  const count = await git($, 'rev-list', '--count', '@{u}..HEAD')
  if (!branch.ok || !count.ok || Number(count.out) === 0) return null

  const upstream = await git($, 'rev-parse', '--abbrev-ref', '@{u}')
  const last = await git($, 'log', '-1', '--format=%h %s')
  const [head = '', ...subject] = last.out.split(' ')

  return {
    branch: branch.out,
    upstream: upstream.ok ? upstream.out : 'upstream',
    count: Number(count.out),
    head,
    subject: subject.join(' '),
  }
}

// --- Band state --------------------------------------------------------------
// One value says what the band shows. Its transitions:
//
//   clean     → ahead      a refresh finds unpushed commits
//   ahead     → dismissed  Later; back to ahead when a refresh finds a new head
//   ahead     → pushing    Push; then clean when it succeeds, failed when not
//   failed    → pushing    Push again; ahead when a refresh finds a new head
//   any       → clean      a refresh finds nothing to push (but not mid-push)
//
// Only transition is used outside this section. It stays in register.tsx
// because the engine won't follow $ into an imported function.

type BandEvent =
  | { type: 'found'; ahead: Ahead | null }
  | { type: 'later' }
  | { type: 'push' }
  | { type: 'pushed' }
  | { type: 'rejected'; error: string }

const band = atom({ plugin: 'push-band', key: 'band' } as const, { kind: 'clean' } as Band)

const step = (state: Band, event: BandEvent): Band => {
  switch (event.type) {
    case 'found': {
      // The push in flight settles the band itself.
      if (state.kind === 'pushing') return state
      if (event.ahead === null) return { kind: 'clean' }
      // Later and a failure both hold until the head moves.
      if ((state.kind === 'dismissed' || state.kind === 'failed') && state.ahead.head === event.ahead.head) {
        return { ...state, ahead: event.ahead }
      }
      return { kind: 'ahead', ahead: event.ahead }
    }
    case 'later':
      return state.kind === 'ahead' || state.kind === 'failed' ? { kind: 'dismissed', ahead: state.ahead } : state
    case 'push':
      return state.kind === 'ahead' || state.kind === 'failed' ? { kind: 'pushing', ahead: state.ahead } : state
    case 'pushed':
      return state.kind === 'pushing' ? { kind: 'clean' } : state
    case 'rejected':
      return state.kind === 'pushing' ? { kind: 'failed', ahead: state.ahead, error: event.error } : state
  }
}

// Applies the event; resolves to whether the band moved.
const transition = async ($: EngineInterface, event: BandEvent) => {
  let moved = false
  await update($, band, state => {
    const after = step(state, event)
    moved = after !== state
    return after
  })

  return moved
}

// --- Refresh and push --------------------------------------------------------

const commits = (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`

const refresh = async ($: EngineInterface) => {
  await transition($, { type: 'found', ahead: await findAhead($) })
}

const push = async ($: EngineInterface, target: Ahead) => {
  if (!(await transition($, { type: 'push' }))) return

  const result = await git($, 'push')
  if (!result.ok) {
    await transition($, { type: 'rejected', error: result.err.split('\n').at(-1) || 'git push failed' })
    return
  }

  await transition($, { type: 'pushed' })
  $.ui.toast(`Pushed ${commits(target.count)} to ${target.upstream}`)
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refresh($)

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (!e.agentId) await refresh($)

    return completed
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, band)
    if (e.props.hasSurvey || e.props.isWorking || state.kind === 'clean' || state.kind === 'dismissed') {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const target = state.ahead

    if (state.kind === 'pushing') {
      return <Text dimColor>Pushing {commits(target.count)} to {target.upstream}…</Text>
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text>
            ↑ {commits(target.count)} on {target.branch} not pushed · {target.head} {target.subject}{' '}
          </Text>
          <Button key="push" label="Push" hotkey="p" variant="primary" onPress={() => push($, target)} />
          <Button key="later" label="Later" hotkey="l" dimColor onPress={() => transition($, { type: 'later' })} />
        </Box>
        {state.kind === 'failed' && <Text color="red">Push failed: {state.error}</Text>}
      </Box>
    )
  })
}
