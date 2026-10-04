import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptSubmitInput, Register } from 'claude-code'

import type { IssueRow } from '../types'

// --- Issue handoff -----------------------------------------------------------
// An issue /issue fetched is staged, and goes to the model as context with the
// next prompt the person sends, if that prompt still names it. Only stage and
// claim are used outside this section.

type Issue = {
  number: number
  title: string
  body: string
  state: string
  labels: { name: string }[]
  comments: { author: { login: string }; body: string }[]
}

const BODY_LIMIT = 20_000

const staged = atom({ plugin: 'issue', key: 'staged' } as const, null)

// What the model reads with the prompt, so it needs no `gh issue view` of its own.
const describe = (issue: Issue) => {
  const labels = issue.labels.map(label => label.name).join(', ') || 'none'
  const comments = issue.comments.map(c => `--- comment by @${c.author.login}\n${c.body}`)
  const text = [
    `GitHub issue #${issue.number}, fetched by /issue just now (state ${issue.state}, labels: ${labels}).`,
    `Title: ${issue.title}`,
    '',
    issue.body || '(no description)',
    ...comments,
  ].join('\n')

  return text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}\n[cut at ${BODY_LIMIT} characters]` : text
}

// Only the person's own prompts claim the staged issue; a peer's, a schedule's
// or a plugin's neither gets it nor uses it up.
const isPersons = (origin: PromptSubmitInput['origin']) => origin.kind === 'composer' || origin.kind === 'bridge'

// `#33` as a whole reference: not `#330`, `abc#33` or `other/repo#33`.
const mentions = (text: string, number: number) => new RegExp(`(?<![\\w/])#${number}(?!\\d)`).test(text)

// Stage an issue for the next prompt, replacing any staged before it.
const stage = async ($: EngineInterface, issue: Issue) => {
  await update($, staged, () => ({ number: issue.number, context: describe(issue) }))
}

// The context to send with this prompt, or null. The person's next prompt uses
// the staged issue up whether or not it names it.
const claim = async ($: EngineInterface, e: Pick<PromptSubmitInput, 'text' | 'origin'>) => {
  if (!isPersons(e.origin)) return null

  const issue = await read($, staged)
  if (issue === null) return null

  await update($, staged, () => null)
  return mentions(e.text, issue.number) ? issue.context : null
}

// --- /issue command and pane --------------------------------------------------

const PANE = 'issue-list'

const open = atom({ plugin: 'issue', key: 'open' } as const, null)
const error = atom({ plugin: 'issue', key: 'error' } as const, null)

const gh = async ($: EngineInterface, ...args: string[]) => {
  const { exitCode, stdout, stderr } = await $.process.run(['gh', ...args], { timeoutMs: 20_000 })

  return { ok: exitCode === 0, out: stdout, err: stderr.trim().split('\n').at(-1) ?? '' }
}

const load = async ($: EngineInterface, number: number) => {
  const fields = 'number,title,body,state,labels,comments'
  const view = await gh($, 'issue', 'view', String(number), '--json', fields)
  if (!view.ok) return `gh issue view ${number} failed: ${view.err}`

  const issue = JSON.parse(view.out) as Issue
  await stage($, issue)
  const closed = issue.state === 'OPEN' ? '' : ` (it is ${issue.state.toLowerCase()})`
  await $.prompt.fill({
    text: `Work on GitHub issue #${number}: ${issue.title}${closed}. Commit with "Closes #${number}" in the message.`,
  })

  return `Loaded #${number} into the prompt. Press Enter to start.`
}

const refresh = async ($: EngineInterface) => {
  const list = await gh($, 'issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,labels')
  if (!list.ok) {
    await update($, error, () => `gh issue list failed: ${list.err}`)
    return
  }

  const rows = (JSON.parse(list.out) as Pick<Issue, 'number' | 'title' | 'labels'>[]).map(issue => ({
    number: issue.number,
    title: issue.title,
    labels: issue.labels.map(label => label.name),
  }))
  await update($, error, () => null)
  await update($, open, () => rows)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'issue',
      description: 'Load GitHub issue N into the prompt (/issue 33), or pick from open issues (/issue)',
    })

    return next(e)
  })

  on('command.run', { command: 'issue' }, async ($, e) => {
    const arg = e.args.trim().replace(/^#/, '')

    if (arg === '') {
      await update($, open, () => null)
      await $.ui.open({ id: PANE, title: 'Open issues', focus: true })
      await refresh($)
      return {}
    }

    if (!/^\d+$/.test(arg)) return { text: `Usage: /issue 33, or /issue for a list (got "${e.args}")` }

    return { text: await load($, Number(arg)) }
  })

  on('prompt.submit', async ($, e, next) => {
    const context = await claim($, e)

    return next(context === null ? e : { ...e, context: [...(e.context ?? []), context] })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = await read($, open)
    const failure = await read($, error)

    const pick = async (row: IssueRow) => {
      const result = await load($, row.number)
      await $.ui.close({ id: PANE })
      $.ui.toast(result)
    }

    return (
      <Box flexDirection="column">
        {failure && <Text color="red">{failure}</Text>}
        {!failure && rows === null && <Text dimColor>Loading open issues…</Text>}
        {rows?.length === 0 && <Text dimColor>No open issues.</Text>}
        {rows?.map((row, index) => (
          <Box>
            <Button
              key={`issue-${row.number}`}
              label={`#${row.number} ${row.title}`}
              hotkey={index < 9 ? String(index + 1) : undefined}
              plain
              onPress={() => pick(row)}
            />
            {row.labels.length > 0 && <Text dimColor> {row.labels.join(', ')}</Text>}
          </Box>
        ))}
        <Box>
          <Button key="refresh" label="Refresh" hotkey="r" dimColor onPress={() => refresh($)} />
          <Button key="close" label="Close" role="dismiss" dimColor onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
