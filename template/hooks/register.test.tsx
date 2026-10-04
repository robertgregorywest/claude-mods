import { expect, test } from 'claude-code/testing'

test('says it loaded in the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', async (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  expect(statuses).toEqual(['mod-template loaded'])
})
