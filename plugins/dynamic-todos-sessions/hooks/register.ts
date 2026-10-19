import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Session } from '../types'

// Claude Code work becomes tasks in Dynamic Todos (James, 12 Oct 2026):
//   - your prompt → joins the session's task, which carries the session's name
//     exactly as Claude shows it ("CPB billing"); a new session, or a prompt
//     after 3 quiet hours, starts a fresh one (an AI title stands in until
//     Claude has named the session). Tasks go inside the agent named for this
//     computer (the app makes the agent if it isn't there);
//   - each turn Claude finishes → one line on the task, and its follow-up alarm
//     goes off at once: Claude is waiting on you;
//   - Claude stops mid-turn to ask you something (a permission prompt, a
//     question) → the alarm goes off at once, with no line, and says what
//     Claude is asking ("asks: Which account…?", "wants to use Bash: npm test");
//   - you answer (a prompt, the permission, the question) → it stops;
//   - a prompt that starts a clearly different task → the task is renamed for
//     it, and the Claude session too at your next prompt (hooks can only name
//     a session as a prompt goes in), so the two names still match.
// The app does the filing (routes/claudeSessions.js); this only reports. It
// never holds up a prompt: the requests run on a timer, after the hook returns,
// and a failed one is dropped with one notice per load.

const SESSION = { plugin: 'dynamic-todos-sessions', key: 'session' } as const
const TITLE_MODEL = 'haiku'

type Config = { base: string; token: string; computer: string }

let hasWarned = false
// What Claude is waiting on you for, if anything, and in which session: the
// end of a turn, or a question it stopped to ask mid-turn. Your next prompt
// answers either; a tool going on after a permission prompt or question
// answers only 'ask'.
// `exact` is set once the app has been told precisely what Claude asks (the
// tool and its command, or the questions), not just the notification's words.
let waiting: { kind: 'turn' | 'ask'; sessionId: string; exact?: boolean } | null = null
// The session's name as Claude shows it ("CPB billing"), from the latest
// prompt; the task carries it verbatim. Empty until Claude has named it.
let sessionTitle = ''
// A change of task (James, 15 Oct 2026): the new name waiting to be given to
// the Claude session at the next prompt, the name Claude last reported (so a
// rename you make yourself meanwhile wins), and your last few prompts, which
// the check reads for context.
let pendingTitle = ''
let seenTitle = ''
let recentPrompts: string[] = []
// Shorter prompts ("yes", "go ahead", "now the tests") are follow-ups; they
// never rename anything, and cost no check.
const MIN_WORDS_TO_CHECK = 6
// Prompts' requests, one after another, so a quick turn waits for its task.
let starting: Promise<void> = Promise.resolve()

// The settings, from /config where it's available, else from Windows
// environment variables (the Code tab has no /config): DYNAMIC_TODOS_TOKEN and
// DYNAMIC_TODOS_COMPUTER, the computer name falling back to its own (Windows'
// COMPUTERNAME, else HOSTNAME). The connect line from Dynamic Todos (⚙ menu)
// sets all three in /config for you.
async function readConfig($: EngineInterface, options: PluginOptions): Promise<Config> {
  const token = String(options.token || '').trim() || (await $.env.get('DYNAMIC_TODOS_TOKEN')) || ''
  const computer = String(options.computer || '').trim() ||
    (await $.env.get('DYNAMIC_TODOS_COMPUTER')) || (await $.env.get('COMPUTERNAME')) ||
    (await $.env.get('HOSTNAME')) || 'This computer'
  return {
    base: String(options.url || '').trim().replace(/\/+$/, ''),
    token: token.trim(),
    computer: computer.trim(),
  }
}

function warn($: EngineInterface, why: string) {
  if (hasWarned) return
  hasWarned = true
  $.ui.toast(`Dynamic Todos: ${why}`, { timeoutMs: 8000 })
}

type Reply = { joined?: boolean; needsTask?: boolean; ignored?: string; task?: { title?: string } }

// POST to the app; its JSON reply when it answers 2xx, else null.
async function send($: EngineInterface, config: Config, path: 'prompt' | 'start' | 'turn' | 'attention' | 'back' | 'rename', body: object): Promise<Reply | null> {
  try {
    const res = await $.http.fetch(`${config.base}/api/claude-sessions/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ ...body, computer: config.computer }),
    })
    if (res.status === 401 || res.status === 302) warn($, 'the token was refused. Check it in /config.')
    else if (!res.ok) warn($, `the app answered ${res.status}.`)
    if (!res.ok) return null
    try { return JSON.parse(res.text) as Reply } catch { return {} }
  } catch {
    warn($, `couldn't reach ${config.base}.`)
    return null
  }
}

// A few words for the task's title; the prompt's opening if the model can't.
async function titleFor($: EngineInterface, prompt: string) {
  const r = await $.model.complete({
    model: TITLE_MODEL,
    system: 'You name to-do list items. Reply with a title of 3 to 7 words for the request, in plain words, no quotes, no ending period.',
    prompt: prompt.slice(0, 4000),
    maxTokens: 40,
    timeoutMs: 15000,
  })
  const said = r.isAnswered ? (r.text.split('\n')[0] ?? '').replace(/^["'\s]+|["'.\s]+$/g, '') : ''
  if (said) return said.slice(0, 100)
  const opening = prompt.replace(/\s+/g, ' ').trim()
  return opening.length > 60 ? `${opening.slice(0, 59).trimEnd()}…` : opening || 'Claude Code session'
}

// Has the session moved on to a different task? The new task's title, or ''
// when it's the same one (a follow-up, a correction, the next step).
async function newTaskTitle($: EngineInterface, current: string, recent: string[], prompt: string) {
  const r = await $.model.complete({
    model: TITLE_MODEL,
    system: 'You keep a to-do list title in step with a working session. Decide whether the new message starts a clearly different task: a new subject or goal. A follow-up, a correction, a question about the work, or the next step of the same task is not a different task. Reply with exactly SAME, or with a title of 3 to 6 words for the new task, in plain words, no quotes, no ending period.',
    prompt: [
      `The session's task is titled: ${current}`,
      recent.length ? `Earlier messages:\n${recent.map(m => `- ${m.slice(0, 500)}`).join('\n')}` : '',
      `New message:\n${prompt.slice(0, 2000)}`,
    ].filter(Boolean).join('\n\n'),
    maxTokens: 30,
    timeoutMs: 15000,
  })
  if (!r.isAnswered) return ''
  const said = (r.text.split('\n')[0] ?? '').replace(/^["'\s]+|["'.\s]+$/g, '').slice(0, 100)
  if (!said || /^same$/i.test(said) || said.toLowerCase() === current.toLowerCase()) return ''
  return said
}

// Your prompt: join the session's task (the app renames it to the session's
// name if that's changed), or — a new session, or after 3 quiet hours — start
// one, named for the session, or with an AI title until Claude names it.
async function reportPrompt($: EngineInterface, config: Config, claim: Session, prompt: string, named: string) {
  const cwd = await $.session.cwd()
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || ''
  const r = await send($, config, 'prompt', { sessionId: claim.sessionId, sessionTitle: named })
  if (!r || r.ignored) return
  if (r.joined) {
    const current = r.task?.title || claim.title
    await $.state.set(SESSION, { ...claim, title: current, folder })
    const earlier = recentPrompts
    recentPrompts = [...recentPrompts, prompt].slice(-3)
    if (!current || prompt.trim().split(/\s+/).length < MIN_WORDS_TO_CHECK) return
    const renamed = await newTaskTitle($, current, earlier, prompt)
    if (!renamed) return
    await send($, config, 'rename', { sessionId: claim.sessionId, title: renamed })
    await $.state.set(SESSION, { ...claim, title: renamed, folder })
    sessionTitle = renamed
    pendingTitle = renamed
    return
  }
  if (r.needsTask) {
    recentPrompts = [prompt]
    const session: Session = { ...claim, title: named || await titleFor($, prompt), folder }
    await $.state.set(SESSION, session)
    await send($, config, 'start', { ...session, sessionTitle: named })
  }
}

async function reportTurn($: EngineInterface, config: Config, sessionId: string, answer: string) {
  await starting
  const { value } = await $.state.get(SESSION)
  if (value?.sessionId !== sessionId) return
  await send($, config, 'turn', { ...value, sessionTitle, answer: answer.slice(0, 2000) })
}

// Tell the app: Claude needs you (and for what), or you're back, for a
// session that has a task.
async function signal($: EngineInterface, config: Config, sessionId: string, path: 'attention' | 'back', waitingOn?: string) {
  await starting
  await send($, config, path, waitingOn ? { sessionId, waitingOn } : { sessionId })
}

// One line on what Claude is waiting for, for the alarm bar in Dynamic Todos
// (James, 17 Oct 2026: "It would be nice for Dynamic ToDos to tell me what it
// needs").
const short = (text: unknown, max: number) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function toolAsk(tool: string, input: unknown) {
  // mcp__<server>__<tool> reads as just the tool.
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(2).join('__') || tool : tool
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const arg = ['command', 'file_path', 'path', 'url', 'pattern', 'query', 'description', 'prompt']
    .map(k => args[k]).find(v => typeof v === 'string' && v.trim())
  return `wants to use ${name}${arg ? `: ${short(arg, 160)}` : ''}`
}

type Question = { question?: string; options?: { label?: string }[] }
function questionsAsk(questions: unknown) {
  const qs = (Array.isArray(questions) ? questions : []) as Question[]
  if (!qs.length) return 'has a question for you'
  return 'asks: ' + qs.map(q => {
    const labels = (q.options ?? []).map(o => o.label).filter(Boolean)
    return `${short(q.question, 160)}${labels.length ? ` (${labels.join(' / ')})` : ''}`
  }).join(' · ')
}

// The session this one has filed, if it's the current one.
async function filedSession($: EngineInterface) {
  const sessionId = await $.session.id()
  const { value } = await $.state.get(SESSION)
  return value?.sessionId === sessionId ? sessionId : null
}

// `what` is one line on what Claude asks. `exact` marks the precise version
// (the tool and its command, the questions) over a notification's general
// words: when the notification came first, the precise one follows it as an
// update. Otherwise one alarm per wait.
async function needsYou($: EngineInterface, options: PluginOptions, what: string, exact: boolean) {
  if (waiting && !(waiting.kind === 'ask' && exact && !waiting.exact)) return
  const config = await readConfig($, options)
  if (!config.token || !config.base) return
  const sessionId = waiting?.sessionId ?? await filedSession($)
  if (!sessionId) return
  waiting = { kind: 'ask', sessionId, exact }
  $.clock.after(0, () => {
    signal($, config, sessionId, 'attention', what).catch(() => {})
  })
}

// The session that was waiting gets the word, even if a /clear has started a
// new one since — its alarm is the one ringing.
async function youreBack($: EngineInterface, options: PluginOptions, answers: 'any' | 'ask') {
  if (!waiting || (answers === 'ask' && waiting.kind !== 'ask')) return
  const { sessionId } = waiting
  waiting = null
  const config = await readConfig($, options)
  if (!config.token || !config.base) return
  $.clock.after(0, () => {
    signal($, config, sessionId, 'back').catch(() => {})
  })
}

export const register: Register = (on, options) => {
  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    if ('drop' in entered) return entered
    // Your own prompts only: typed here or sent from your phone.
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return entered
    await youreBack($, options, 'any')

    const config = await readConfig($, options)
    if (!config.token || !config.base) return entered
    const sessionId = await $.session.id()
    // Note the session at once, so a quick question or turn knows it's filed;
    // the title comes in once the app has answered.
    const held = await $.state.get(SESSION)
    const claim: Session = {
      sessionId,
      title: held.value?.sessionId === sessionId ? held.value.title : '',
      prompt: e.text.slice(0, 1000),
      folder: held.value?.sessionId === sessionId ? held.value.folder : '',
    }
    await $.state.set(SESSION, claim)

    $.clock.after(0, () => {
      // Read once the prompt is in: Claude hands its name over with the prompt.
      const named = sessionTitle
      starting = starting.then(() => reportPrompt($, config, claim, e.text, named)).catch(() => {})
    })
    return entered
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // The main conversation's answered turns; not a subagent's, not one you
    // stopped, not one an error ended.
    if (e.agentId || e.reason !== 'answer') return done
    const config = await readConfig($, options)
    if (!config.token || !config.base) return done

    const sessionId = await $.session.id()
    if (await filedSession($)) waiting = { kind: 'turn', sessionId }
    $.clock.after(0, () => {
      reportTurn($, config, sessionId, e.answer).catch(() => {})
    })
    return done
  })

  // The session's name, as Claude passes it with each prompt and at start —
  // and where a waiting new name is given to the session, unless you've
  // renamed it yourself since (then yours wins).
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const reported = (e.session_title || '').trim()
    if (pendingTitle && reported && seenTitle && reported !== seenTitle) pendingTitle = ''
    if (reported) seenTitle = reported
    if (pendingTitle) {
      const title = pendingTitle
      pendingTitle = ''
      sessionTitle = title
      seenTitle = title
      return { ...(await next(e)), sessionTitle: title }
    }
    if (reported) sessionTitle = reported
    return next(e)
  })
  on('classic.SessionStart', async ($, e, next) => {
    if (e.session_title) sessionTitle = seenTitle = e.session_title.trim()
    return next(e)
  })

  // A permission prompt or a question dialog: Claude is stuck until you answer.
  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt' || e.notification_type === 'elicitation_dialog') {
      await needsYou($, options, short(e.message, 300) || 'needs you', false)
    }
    return next(e)
  })
  on('classic.PermissionRequest', async ($, e, next) => {
    await needsYou($, options, toolAsk(e.tool_name, e.tool_input), true)
    return next(e)
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await needsYou($, options, questionsAsk((e as { questions?: unknown }).questions), true)
    return next(e)
  })
  // Whatever the tool, once it goes on (or is turned down) you've answered.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    await youreBack($, options, 'ask')
    return ran
  })
}
