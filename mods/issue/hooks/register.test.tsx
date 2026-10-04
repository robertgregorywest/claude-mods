import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ISSUE_33 = {
  number: 33,
  title: 'Rename IntervalsClient to Services',
  body: 'The composition root now wires many services.',
  state: 'OPEN',
  labels: [{ name: 'ready-for-agent' }],
  comments: [{ author: { login: 'octocat' }, body: 'Keep createClient as an alias for one release.' }],
}

const ISSUE_34 = { ...ISSUE_33, number: 34, title: 'Drop syntax-doc from the CLI', comments: [] }

const OPEN = [
  { number: 33, title: ISSUE_33.title, labels: [{ name: 'ready-for-agent' }] },
  { number: 34, title: 'Drop syntax-doc from the CLI', labels: [] },
]

const COMMAND = {
  command: 'issue',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
}

const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

// Stands in for the engine and gh; records what reaches the prompt box, the model and the panes.
const fakeEngine = (on: On, { ghFails = false } = {}) => {
  const seen = { fills: [] as string[], submits: [] as { text: string; context: readonly string[] }[], panes: [] as string[], toasts: [] as string[] }

  on('process.run', async (_$, e) => {
    const args = e.argv.join(' ')
    if (ghFails) return ran('', 1, 'HTTP 404: Could not resolve to an issue')
    if (args.startsWith('gh issue view 33 ')) return ran(JSON.stringify(ISSUE_33))
    if (args.startsWith('gh issue view 34 ')) return ran(JSON.stringify(ISSUE_34))
    if (args.startsWith('gh issue list ')) return ran(JSON.stringify(OPEN))
    throw new Error(`unexpected ${args}`)
  })
  on('prompt.fill', async (_$, e) => {
    seen.fills.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.submit', async (_$, e) => {
    seen.submits.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('ui.open', async (_$, e) => {
    seen.panes.push(`open ${e.id}`)
    return { value: { isPlaced: true as const, id: e.id } }
  })
  on('ui.close', async (_$, e) => {
    seen.panes.push(`close ${e.id}`)
    return { value: undefined }
  })
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  return seen
}

const PANE = (surface: 'terminal' | 'desktop') => ({
  plugin: 'issue',
  surface,
  component: 'Pane' as const,
  requestId: 'issue-list',
  props: {
    title: 'Open issues',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
})

test('/issue 33 fills the prompt and hands the issue to the model with it', async ($, on) => {
  const seen = fakeEngine(on)

  const result = await $.command.run({ ...COMMAND, args: '#33' })
  expect(result.text).toBe('Loaded #33 into the prompt. Press Enter to start.')
  expect(seen.fills).toEqual([
    'Work on GitHub issue #33: Rename IntervalsClient to Services. Commit with "Closes #33" in the message.',
  ])

  await $.prompt.submit({ text: 'Work on GitHub issue #33', wait: false, origin: { kind: 'composer' } })
  const context = seen.submits[0]?.context.join('\n') ?? ''
  expect(context).toMatch(/GitHub issue #33, fetched by \/issue/)
  expect(context).toMatch(/labels: ready-for-agent/)
  expect(context).toMatch(/Keep createClient as an alias/)

  // Only once: the next prompt goes through untouched.
  await $.prompt.submit({ text: 'and #33 again', wait: false, origin: { kind: 'composer' } })
  expect(seen.submits[1]?.context).toEqual([])
})

test('a prompt about something else does not carry the issue, and drops it', async ($, on) => {
  const seen = fakeEngine(on)
  await $.command.run({ ...COMMAND, args: '33' })

  await $.prompt.submit({ text: 'what is the weather', wait: false, origin: { kind: 'composer' } })
  expect(seen.submits[0]?.context).toEqual([])

  // Only the next prompt could have claimed it.
  await $.prompt.submit({ text: 'Work on GitHub issue #33', wait: false, origin: { kind: 'composer' } })
  expect(seen.submits[1]?.context).toEqual([])
})

test('only a whole #33 claims issue 33', async ($, on) => {
  const seen = fakeEngine(on)

  for (const text of ['look at #330 first', 'like other/repo#33 does', 'see abc#33']) {
    await $.command.run({ ...COMMAND, args: '33' })
    await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  }
  expect(seen.submits.map(submit => submit.context)).toEqual([[], [], []])

  await $.command.run({ ...COMMAND, args: '33' })
  await $.prompt.submit({ text: 'Fix #33.', wait: false, origin: { kind: 'composer' } })
  expect(seen.submits[3]?.context.join('\n')).toMatch(/GitHub issue #33, fetched by \/issue/)
})

test("a peer's prompt neither gets the issue nor uses it up", async ($, on) => {
  const seen = fakeEngine(on)
  await $.command.run({ ...COMMAND, args: '33' })

  await $.prompt.submit({ text: 'status of #33?', wait: false, origin: { kind: 'peer' } })
  expect(seen.submits[0]?.context).toEqual([])

  await $.prompt.submit({ text: 'Work on GitHub issue #33', wait: false, origin: { kind: 'composer' } })
  expect(seen.submits[1]?.context.join('\n')).toMatch(/GitHub issue #33, fetched by \/issue/)
})

test('loading another issue replaces the staged one', async ($, on) => {
  const seen = fakeEngine(on)
  await $.command.run({ ...COMMAND, args: '33' })
  await $.command.run({ ...COMMAND, args: '34' })

  await $.prompt.submit({ text: 'Work on #33 and #34', wait: false, origin: { kind: 'composer' } })
  const context = seen.submits[0]?.context.join('\n') ?? ''
  expect(context).toMatch(/GitHub issue #34, fetched by \/issue/)
  expect(context).not.toMatch(/GitHub issue #33/)
})

test('reports gh failures and bad arguments without touching the prompt', async ($, on) => {
  const seen = fakeEngine(on, { ghFails: true })

  expect((await $.command.run({ ...COMMAND, args: '33' })).text).toBe(
    'gh issue view 33 failed: HTTP 404: Could not resolve to an issue',
  )
  expect((await $.command.run({ ...COMMAND, args: 'abc' })).text).toMatch(/^Usage: \/issue 33/)
  expect(seen.fills).toEqual([])
})

test('/issue alone lists open issues; picking one fills the prompt and closes the pane', async ($, on) => {
  const seen = fakeEngine(on)
  await $.command.run({ ...COMMAND, args: '' })
  expect(seen.panes).toEqual(['open issue-list'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect(await ui.find({ type: 'Button', text: /#34 Drop syntax-doc from the CLI/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'issue-33' })
  expect(seen.fills[0]).toMatch(/^Work on GitHub issue #33:/)
  expect(seen.panes).toEqual(['open issue-list', 'close issue-list'])
  expect(seen.toasts).toEqual(['Loaded #33 into the prompt. Press Enter to start.'])
})

test('the pane says so when gh cannot list issues', async ($, on) => {
  fakeEngine(on, { ghFails: true })
  await $.command.run({ ...COMMAND, args: '' })

  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /gh issue list failed: HTTP 404/ })).toBeDefined()
})
