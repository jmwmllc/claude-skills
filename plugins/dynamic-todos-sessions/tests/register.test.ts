import type { HttpInit, ModelUsage, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const OPTIONS = { url: 'https://todos.test/', token: 'secret', computer: 'Gaming PC' }
const USAGE: ModelUsage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

type Sent = { path: string; auth: string | undefined; body: Record<string, unknown> }

// What the engine itself does beneath the plugin: a prompt enters, a turn ends,
// a tool runs; and the environment it reads.
function engine(on: On, env: Record<string, string> = {}) {
  mock.env(on, env)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  on('classic.Notification', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.SessionStart', () => ({}))
}

// Dynamic Todos, as the mod sees it: /prompt answers "needs a task" until one
// has been started (or `fresh` is set), then "joined". Records every request.
function app(on: On, opts: { status?: number; title?: string; noTitle?: boolean; replies?: string[] } = {}) {
  const sent: Sent[] = []
  const state = { hasTask: false, titles: 0 }
  on('http.fetch', (_$, e) => {
    const init: HttpInit | undefined = e.init
    const path = e.url.replace('https://todos.test/api/claude-sessions/', '')
    sent.push({ path, auth: init?.headers?.Authorization, body: JSON.parse(init?.body ?? '{}') })
    const status = opts.status ?? 200
    let reply: object = {}
    if (path === 'prompt') reply = state.hasTask ? { joined: true, task: { title: 'Current task' } } : { needsTask: true }
    if (path === 'start') state.hasTask = true
    return { value: { status, ok: status < 300, headers: {}, text: JSON.stringify(reply) } }
  })
  on('model.complete', () => {
    state.titles++
    // `replies`: what the model says, call by call (a title, then each check).
    const scripted = opts.replies && opts.replies.length ? opts.replies.shift() : undefined
    return opts.noTitle
      ? { value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }
      : { value: { isAnswered: true, text: scripted ?? opts.title ?? 'Title', usage: USAGE } }
  })
  return { sent, state, paths: () => sent.map(s => s.path) }
}

const prompt = (text: string, kind: 'composer' | 'task-notification' = 'composer') =>
  ({ text, wait: false, origin: { kind } }) as const
const turn = (answer: string, extra: Partial<{ agentId: string; reason: 'answer' | 'aborted' }> = {}) =>
  ({ answer, durationMs: 1000, isAborted: extra.reason === 'aborted', turnId: 't', reason: extra.reason ?? 'answer', agentId: extra.agentId }) as const

test('a prompt that needs a new task titles it and starts it', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on, { title: '"Fix snooze alarm bug."\n' })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\me\\GitHub\\dynamictodo' }))

  await $.prompt.submit(prompt('When I snooze a task the follow-up alarm keeps ringing, please fix it'))
  await clock.settle()
  expect(todos.paths()).toEqual(['prompt', 'start'])
  expect(todos.sent[0]).toEqual({ path: 'prompt', auth: 'Bearer secret', body: { sessionId: 'session-1', sessionTitle: '', computer: 'Gaming PC' } })
  expect(todos.sent[1]?.body).toEqual({
    sessionId: 'session-1',
    sessionTitle: '',
    title: 'Fix snooze alarm bug',
    prompt: 'When I snooze a task the follow-up alarm keeps ringing, please fix it',
    folder: 'dynamictodo',
    computer: 'Gaming PC',
  })
})

test('a prompt within the window joins: no title, no new task; turns report', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on)
  let sessionId = 'session-1'
  on('session.id', () => ({ value: sessionId }))
  on('session.cwd', () => ({ value: '/w' }))

  await $.prompt.submit(prompt('First'))
  await clock.settle()
  await $.prompt.submit(prompt('Second, an hour later'))
  await clock.settle()
  await $.turn.complete(turn('Fixed: snoozing now clears the alarm.'))
  await clock.settle()
  expect(todos.paths()).toEqual(['prompt', 'start', 'prompt', 'turn'])
  expect(todos.state.titles).toBe(1)
  expect(todos.sent[3]?.body).toEqual(expect.objectContaining({ sessionId: 'session-1', answer: 'Fixed: snoozing now clears the alarm.' }))

  // A /clear (a new session id) checks in too, and the old session — waiting
  // on you after its turn — hears you're back.
  sessionId = 'session-2'
  await $.prompt.submit(prompt('Something else'))
  await clock.settle()
  expect(todos.paths().slice(4)).toEqual(['back', 'prompt'])
  expect(todos.sent[4]?.body.sessionId).toBe('session-1')
  expect(todos.sent[5]?.body.sessionId).toBe('session-2')
  expect(todos.state.titles).toBe(1)
})

test('subagent turns, stopped turns and notifications report nothing', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/home/me/work' }))

  // A background task's notification isn't your prompt.
  await $.prompt.submit(prompt('Background task finished', 'task-notification'))
  await $.turn.complete(turn('Done.'))
  await clock.settle()
  expect(todos.paths()).toEqual([])

  await $.prompt.submit(prompt('Real prompt'))
  await clock.settle()
  await $.turn.complete(turn('Sub result', { agentId: 'agent-1' }))
  await $.turn.complete(turn('Half', { reason: 'aborted' }))
  await clock.settle()
  expect(todos.paths()).toEqual(['prompt', 'start'])
})

test('with no model answer the title is the prompt\'s opening', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on, { noTitle: true })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await $.prompt.submit(prompt('I would like the default snooze time for any day to be six in the morning instead of nine'))
  await clock.settle()
  expect(todos.sent[1]?.body.title).toBe('I would like the default snooze time for any day to be six…')
})

test('without a token it stays quiet', { options: { ...OPTIONS, token: '' } }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on)
  on('session.id', () => ({ value: 'session-1' }))
  await $.prompt.submit(prompt('Hello'))
  await $.turn.complete(turn('Hi.'))
  await clock.settle()
  expect(todos.paths()).toEqual([])
})

test('a refused token is said once, not on every turn', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  app(on, { status: 401 })
  const toasts: string[] = []
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.prompt.submit(prompt('Hello'))
  await clock.settle()
  await $.turn.complete(turn('Hi.'))
  await $.turn.complete(turn('Again.'))
  await clock.settle()
  expect(toasts).toEqual(['Dynamic Todos: the token was refused. Check it in /config.'])
})

test('the token and computer name can come from Windows environment variables', { options: { url: 'https://todos.test' } }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { DYNAMIC_TODOS_TOKEN: 'from-env', DYNAMIC_TODOS_COMPUTER: 'Gaming PC', COMPUTERNAME: 'RUBERTAPC' })
  const todos = app(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await $.prompt.submit(prompt('Hello'))
  await clock.settle()
  expect(todos.sent[0]?.auth).toBe('Bearer from-env')
  expect(todos.sent[0]?.body.computer).toBe('Gaming PC')
})

test('with no name set anywhere, the Windows computer name is used', { options: { url: 'https://todos.test', token: 'secret' } }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { COMPUTERNAME: 'RUBERTAPC' })
  const todos = app(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await $.prompt.submit(prompt('Hello'))
  await clock.settle()
  expect(todos.sent[0]?.body.computer).toBe('RUBERTAPC')
})

test('a tool finishing after a turn is not you answering', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await $.prompt.submit(prompt('Do the thing'))
  await clock.settle()
  await $.turn.complete(turn('Did it.'))
  await clock.settle()
  await $.tool.call({ tool: 'Read', file_path: '/w/a.txt' } as never)
  await clock.settle()
  expect(todos.paths()).toEqual(['prompt', 'start', 'turn'])
})

test('a permission prompt sets the alarm off; answering it stops it', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await $.prompt.submit(prompt('Run the tests'))
  await clock.settle()
  // The engine raises both for one prompt; only one alarm goes off.
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } } as never)
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await clock.settle()
  // Something that isn't Claude waiting on you rings nothing.
  await $.classic.Notification({ message: 'Signed in', notification_type: 'auth_success' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await clock.settle()
  expect(todos.paths()).toEqual(['prompt', 'start', 'attention', 'back'])
  // The alarm says what Claude wants.
  expect(todos.sent.find(s => s.path === 'attention')?.body.waitingOn).toBe('wants to use Bash: npm test')
})

test('when the notification comes first, the exact ask follows as an update', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await $.prompt.submit(prompt('Deploy it'))
  await clock.settle()
  await $.classic.Notification({ message: 'Claude needs your permission to use Railway', notification_type: 'permission_prompt' })
  await $.classic.PermissionRequest({ tool_name: 'mcp__railway__redeploy', tool_input: { description: 'Redeploy the web service' } } as never)
  await clock.settle()
  const asks = todos.sent.filter(s => s.path === 'attention').map(s => s.body.waitingOn)
  expect(asks).toEqual(['Claude needs your permission to use Railway', 'wants to use redeploy: Redeploy the web service'])
})

test('a question from Claude sets the alarm off until you answer it', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await $.prompt.submit(prompt('Plan it with me'))
  await clock.settle()
  await $.tool.call({ tool: 'AskUserQuestion', questions: [
    { question: 'Which account should the IRA go to?', header: 'Account', multiSelect: false, options: [{ label: 'Schwab', description: '' }, { label: 'Fidelity', description: '' }] },
  ] } as never)
  await clock.settle()
  expect(todos.paths()).toEqual(['prompt', 'start', 'attention', 'back'])
  expect(todos.sent.find(s => s.path === 'attention')?.body.waitingOn).toBe('asks: Which account should the IRA go to? (Schwab / Fidelity)')
})

// Claude passes the session's name with each prompt; a test raises that the
// way the engine does, just before the prompt goes in.
async function namedPrompt($: any, text: string, sessionTitle: string) {
  await $.classic.UserPromptSubmit({ prompt: text, session_title: sessionTitle } as never)
  await $.prompt.submit(prompt(text))
}

test("a named session's task is called exactly what Claude calls it, with no AI title", { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await namedPrompt($, 'Look at the March CPB invoices', 'CPB billing')
  await clock.settle()
  expect(todos.paths()).toEqual(['prompt', 'start'])
  expect(todos.sent[0]?.body.sessionTitle).toBe('CPB billing')
  expect(todos.sent[1]?.body).toEqual(expect.objectContaining({ title: 'CPB billing', sessionTitle: 'CPB billing' }))
  expect(todos.state.titles).toBe(0)

  await $.turn.complete(turn('Found two duplicates.'))
  await clock.settle()
  expect(todos.sent[2]?.body).toEqual(expect.objectContaining({ sessionTitle: 'CPB billing' }))
})

test('a rename in Claude goes over with the next prompt', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  // Not named yet: an AI title stands in.
  await $.prompt.submit(prompt('Help me set up Schwab alerts'))
  await clock.settle()
  expect(todos.sent[1]?.body.title).toBe('Title')
  // Claude names the session; the next prompt carries the name.
  await namedPrompt($, 'Also for the IRA', 'Schwab alerts')
  await clock.settle()
  expect(todos.sent[2]).toEqual(expect.objectContaining({ path: 'prompt', body: expect.objectContaining({ sessionTitle: 'Schwab alerts' }) }))
})

test('a prompt that starts a different task renames the task, then the session at the next prompt', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  // Model calls in order: the change-of-task check says it's new work.
  const todos = app(on, { replies: ['Schwab alert setup'] })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await namedPrompt($, 'Look at the March CPB invoices for duplicates', 'CPB billing')
  await clock.settle()
  await namedPrompt($, 'Now set up price alerts in Schwab for my three biggest positions', 'CPB billing')
  await clock.settle()
  expect(todos.paths()).toEqual(['prompt', 'start', 'prompt', 'rename'])
  expect(todos.sent[3]?.body).toEqual({ sessionId: 'session-1', title: 'Schwab alert setup', computer: 'Gaming PC' })

  // The next prompt gives the Claude session the same name.
  const result = await $.classic.UserPromptSubmit({ prompt: 'Start with NVDA', session_title: 'CPB billing' } as never)
  expect(result.sessionTitle).toBe('Schwab alert setup')
  await $.prompt.submit(prompt('Start with NVDA'))
  await clock.settle()
  expect(todos.sent[4]).toEqual(expect.objectContaining({ path: 'prompt', body: expect.objectContaining({ sessionTitle: 'Schwab alert setup' }) }))
})

test('more of the same task renames nothing; short follow-ups are not even checked', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on, { replies: ['SAME'] })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await namedPrompt($, 'Look at the March CPB invoices for duplicates', 'CPB billing')
  await clock.settle()
  await namedPrompt($, 'Also check February and January the same way please', 'CPB billing')
  await clock.settle()
  await namedPrompt($, 'yes go ahead', 'CPB billing')
  await clock.settle()
  expect(todos.paths()).toEqual(['prompt', 'start', 'prompt', 'prompt'])
  expect(todos.state.titles).toBe(1) // the one check; the short follow-up cost nothing
  const result = await $.classic.UserPromptSubmit({ prompt: 'next', session_title: 'CPB billing' } as never)
  expect(result.sessionTitle).toBeUndefined()
})

test('a rename you make yourself wins over a waiting one', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const todos = app(on, { replies: ['Schwab alert setup'] })
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/w' }))

  await namedPrompt($, 'Look at the March CPB invoices for duplicates', 'CPB billing')
  await clock.settle()
  await namedPrompt($, 'Now set up price alerts in Schwab for my three biggest positions', 'CPB billing')
  await clock.settle()
  // You renamed the session in Claude before your next prompt.
  const result = await $.classic.UserPromptSubmit({ prompt: 'Start with NVDA', session_title: 'Brokerage alerts' } as never)
  expect(result.sessionTitle).toBeUndefined()
  await $.prompt.submit(prompt('Start with NVDA'))
  await clock.settle()
  expect(todos.sent[4]?.body.sessionTitle).toBe('Brokerage alerts')
})
