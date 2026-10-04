import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PUSH = {
  command: 'push',
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
}

const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

const NO_UPSTREAM = "fatal: no upstream configured for branch 'main'"

// A fake repo two commits ahead of its upstream; `push` succeeds unless told to fail.
const fakeGit = (on: On, { pushFails = false, upstream = 'origin/main' as string | null } = {}) => {
  const repo = { ahead: 2, pushes: 0, toasts: [] as string[] }

  on('process.run', async (_$, e) => {
    const args = e.argv.slice(1).join(' ')
    if (args === 'rev-parse --abbrev-ref @{u}') return upstream ? ran(`${upstream}\n`) : ran('', 128, NO_UPSTREAM)
    if (args === 'rev-list --count @{u}..HEAD') return upstream ? ran(`${repo.ahead}\n`) : ran('', 128, NO_UPSTREAM)
    if (args === 'push') {
      repo.pushes += 1
      if (pushFails) return ran('', 1, 'To github.com:x/y.git\n ! [rejected] main -> main (fetch first)')
      repo.ahead = 0
      return ran('')
    }
    throw new Error(`unexpected git ${args}`)
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', async (_$, e) => {
    repo.toasts.push(e.text)
    return { value: undefined }
  })

  return repo
}

const start = ($: { session: { start: (e: { cwd: string; surface: null; isInteractive: boolean }) => Promise<unknown> } }) =>
  $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

test('pushes, and says so in a toast rather than the output', async ($, on) => {
  const repo = fakeGit(on)
  await start($)

  expect((await $.command.run(PUSH)).text).toBeUndefined()
  expect(repo.pushes).toBe(1)
  expect(repo.toasts).toEqual(['Pushed 2 commits to origin/main'])
})

test('names the upstream it pushed to, whatever the remote', async ($, on) => {
  const repo = fakeGit(on, { upstream: 'fork/feature' })
  repo.ahead = 1
  await start($)

  await $.command.run(PUSH)
  expect(repo.toasts).toEqual(['Pushed 1 commit to fork/feature'])
})

test('shows the last line of a git push error in the output', async ($, on) => {
  const repo = fakeGit(on, { pushFails: true })
  await start($)

  expect((await $.command.run(PUSH)).text).toBe('Push failed: ! [rejected] main -> main (fetch first)')
  expect(repo.toasts).toEqual([])
})

test("doesn't push when there is nothing to push", async ($, on) => {
  const repo = fakeGit(on)
  repo.ahead = 0
  await start($)

  expect((await $.command.run(PUSH)).text).toBe('Nothing to push: up to date with origin/main.')
  expect(repo.pushes).toBe(0)
})

test("doesn't push a branch with no upstream", async ($, on) => {
  const repo = fakeGit(on, { upstream: null })
  await start($)

  expect((await $.command.run(PUSH)).text).toBe(`Can't push: ${NO_UPSTREAM}`)
  expect(repo.pushes).toBe(0)
})
