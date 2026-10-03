import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ahead } from '../types'

const ahead = atom({ plugin: 'push-band', key: 'ahead' } as const, null)
const dismissedHead = atom({ plugin: 'push-band', key: 'dismissedHead' } as const, null)
const isPushing = atom({ plugin: 'push-band', key: 'isPushing' } as const, false)
const error = atom({ plugin: 'push-band', key: 'error' } as const, null)

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

  const last = await git($, 'log', '-1', '--format=%h %s')
  const [head = '', ...subject] = last.out.split(' ')

  return { branch: branch.out, count: Number(count.out), head, subject: subject.join(' ') }
}

const refresh = async ($: EngineInterface) => {
  const found = await findAhead($)
  await update($, ahead, () => found)
}

const push = async ($: EngineInterface, target: Ahead) => {
  await update($, isPushing, () => true)
  await update($, error, () => null)

  const result = await git($, 'push')
  await update($, isPushing, () => false)

  if (!result.ok) {
    await update($, error, () => result.err.split('\n').at(-1) || 'git push failed')
    return
  }

  const noun = target.count === 1 ? 'commit' : 'commits'
  $.ui.toast(`Pushed ${target.count} ${noun} to origin/${target.branch}`)
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
    const target = await read($, ahead)
    const isQuiet =
      e.props.hasSurvey ||
      e.props.isWorking ||
      target === null ||
      (await read($, dismissedHead)) === target.head

    if (isQuiet) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const failure = await read($, error)
    const noun = target.count === 1 ? 'commit' : 'commits'

    if (await read($, isPushing)) {
      return <Text dimColor>Pushing {target.count} {noun} to origin/{target.branch}…</Text>
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text>
            ↑ {target.count} {noun} on {target.branch} not pushed · {target.head} {target.subject}{' '}
          </Text>
          <Button key="push" label="Push" hotkey="p" variant="primary" onPress={() => push($, target)} />
          <Button
            key="later"
            label="Later"
            hotkey="l"
            dimColor
            onPress={() => update($, dismissedHead, () => target.head)}
          />
        </Box>
        {failure && <Text color="red">Push failed: {failure}</Text>}
      </Box>
    )
  })
}
