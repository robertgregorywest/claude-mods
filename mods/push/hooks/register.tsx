import type { EngineInterface, Register } from 'claude-code'

const git = async ($: EngineInterface, ...args: string[]) => {
  const { exitCode, stdout, stderr } = await $.process.run(['git', ...args], {
    env: { GIT_TERMINAL_PROMPT: '0' },
    timeoutMs: args[0] === 'push' ? 120_000 : 10_000,
  })

  return { ok: exitCode === 0, out: stdout.trim(), err: stderr.trim().split('\n').at(-1)?.trim() ?? '' }
}

const commits = (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`

// Pushes the current branch to its upstream. A success is a toast and no
// output; anything else is said in the command's output, where it stays.
const push = async ($: EngineInterface) => {
  const upstream = await git($, 'rev-parse', '--abbrev-ref', '@{u}')
  if (!upstream.ok) return `Can't push: ${upstream.err || 'no upstream branch'}`

  const count = await git($, 'rev-list', '--count', '@{u}..HEAD')
  if (!count.ok) return `Can't push: ${count.err || 'git rev-list failed'}`
  if (Number(count.out) === 0) return `Nothing to push: up to date with ${upstream.out}.`

  const result = await git($, 'push')
  if (!result.ok) return `Push failed: ${result.err || 'git push failed'}`

  $.ui.toast(`Pushed ${commits(Number(count.out))} to ${upstream.out}`)
  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'push',
      description: 'Push the current branch to its upstream',
    })

    return next(e)
  })

  on('command.run', { command: 'push' }, async $ => {
    const text = await push($)

    return text === null ? {} : { text }
  })
}
