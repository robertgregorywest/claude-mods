import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

const band = (isWorking = false) => ({
  plugin: 'push-band',
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
})

// A fake repo two commits ahead of origin; `push` succeeds unless told to fail.
const fakeGit = (on: On, { pushFails = false } = {}) => {
  const repo = { ahead: 2, pushes: 0, toasts: [] as string[] }
  const ok = (stdout: string) => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })

  on('process.run', async (_$, e) => {
    const args = e.argv.slice(1).join(' ')
    if (args === 'rev-parse --abbrev-ref HEAD') return ok('main\n')
    if (args === 'rev-list --count @{u}..HEAD') return ok(`${repo.ahead}\n`)
    if (args === 'log -1 --format=%h %s') return ok(`abc1234 docs: tidy glossary\n`)
    if (args === 'push') {
      repo.pushes += 1
      if (pushFails) {
        return {
          value: {
            exitCode: 1,
            stdout: '',
            stderr: 'To github.com:x/y.git\n ! [rejected] main -> main (fetch first)',
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        }
      }
      repo.ahead = 0
      return ok('')
    }
    throw new Error(`unexpected git ${args}`)
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  // The engine's own band, drawn when the plugin passes: an empty Box.
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.toast', async (_$, e) => {
    repo.toasts.push(e.text)
    return { value: undefined }
  })

  return repo
}

const start = ($: { session: { start: (e: { cwd: string; surface: null; isInteractive: boolean }) => Promise<unknown> } }) =>
  $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

test('offers a push when main is ahead, and pushes on press', async ($, on) => {
  const repo = fakeGit(on)
  await start($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(), surface })
    expect((await ui.find({ type: 'Text', text: /not pushed/ }))?.text).toMatch(/2 commits on main not pushed · abc1234 docs: tidy glossary/)
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  await ui.press({ key: 'push' })
  expect(repo.pushes).toBe(1)
  expect(repo.toasts).toEqual(['Pushed 2 commits to origin/main'])
  expect(await ui.find({ type: 'Text', text: /not pushed/ })).toBeUndefined()
})

test('shows the last line of git push errors and keeps the button', async ($, on) => {
  fakeGit(on, { pushFails: true })
  await start($)

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  await ui.press({ key: 'push' })
  expect((await ui.find({ type: 'Text', text: /Push failed/ }))?.text).toMatch(/rejected\] main -> main \(fetch first\)/)
  expect(await ui.find({ key: 'push' })).toBeDefined()
})

test('Later hides the band until a new commit lands', async ($, on) => {
  const repo = fakeGit(on)
  await start($)

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  await ui.press({ key: 'later' })
  expect(await ui.find({ type: 'Text', text: /not pushed/ })).toBeUndefined()
  expect(repo.pushes).toBe(0)
})

test('stays out of the way while a turn is running', async ($, on) => {
  fakeGit(on)
  await start($)

  const ui = await $.ui.mount({ ...band(true), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /not pushed/ })).toBeUndefined()
})
