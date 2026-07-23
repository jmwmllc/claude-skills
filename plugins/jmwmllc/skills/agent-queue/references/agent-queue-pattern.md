# The Agent Work Queue Pattern

*A copy-paste spec for having an autonomous coding agent (e.g. Claude Code) build
features you request from inside your own app, on a schedule, safely.*

This document describes a pattern that has worked reliably in production. It's
written to be **lifted into another project wholesale** — replace the app-specific
names and you have a working system. If your project has struggled to get an agent
to "just do the things I ask for," this is the shape that makes it dependable.

---

## 1. What this is, in one paragraph

You add a **"Send to agent" button** to your app. Clicking it flags a record in
your **existing database** (one boolean column — no new infrastructure). A tiny
**authenticated API** exposes the set of flagged records. A **scheduled task on
your dev machine** wakes up every few hours, pulls that list, and for each item:
implements the change in your repo, verifies it, commits, pushes, and then
**acks the item off the queue**. Hard safety rails tell it what to refuse. That's
the whole thing. The power comes from *decoupling "I want this" (capture, from
anywhere, any device) from "build it" (an agent with full repo access, running
unattended)*.

```
┌─────────────┐   flag record    ┌──────────────┐   HTTPS + bearer token   ┌────────────────────┐
│  Your app   │ ───────────────► │  Queue API   │ ◄─────────────────────── │  Scheduled agent   │
│ "Send to    │  (DB boolean)    │ list / ack   │      pull + ack          │ (local dev machine)│
│  agent" btn │                  │  (hosted)    │ ───────────────────────► │  builds + commits  │
└─────────────┘                  └──────────────┘                          └────────────────────┘
                                        ▲                                            │
                                        └──────────── git push ──────────────────────┘
                                              (agent commits straight to the repo)
```

**Why it works when other setups don't:**

- **The queue is a flag, not a system.** No message broker, no separate queue
  service. A column your DB already knows how to store. Nothing to operate.
- **Capture is decoupled from execution.** You (or teammates) can flag work from
  a phone, mid-meeting, by voice — the agent picks it up later. You never wait on
  the agent, and the agent never waits on you.
- **The agent has everything it needs to finish the job unattended:** the repo,
  a way to run/verify the app, and permission to commit and push. A request that
  can't be completed end-to-end just stays in the queue.
- **Ack is idempotent and explicit.** An item leaves the queue only when the
  agent (or you) marks it done. Crashes, retries, and duplicate runs are safe.
- **Autonomy is fenced.** Explicit refuse-rules + a hard self-expiry date mean an
  unattended agent can't quietly do something destructive or run forever.

---

## 2. The four moving parts

### Part A — The queue store: a boolean on an existing record

Don't build a queue table. Add one flag to whatever records represent "a thing
someone might ask for" (tasks, tickets, notes, whatever your app already has):

```sql
ALTER TABLE tasks ADD COLUMN sent_to_agent INTEGER DEFAULT 0;  -- "in the queue"
ALTER TABLE tasks ADD COLUMN agent_sent      INTEGER DEFAULT 0; -- "ever sent" (optional, see below)
```

**Two flags, not one — this is a real lesson.** `sent_to_agent` = *currently in
the queue* (cleared on ack). `agent_sent` = *has ever been sent* (never cleared).
Drive the button's disabled/"Sent ✓" state off `agent_sent`, not `sent_to_agent`.
If you key the button off the in-queue flag alone, then the moment the agent acks
an item the button re-enables and the same request gets submitted again on the
next click or reload. The second flag is what stops accidental resubmission.

### Part B — Enqueue: the "Send to agent" action

A single endpoint that flips the flag. Idempotent — flagging twice is a no-op.

```js
// POST /api/agent-queue/:id/send  — put a record in the queue
router.post('/:id/send', (req, res) => {
  const item = db.getById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const already = !!item.sentToAgent;
  if (!already) db.update(item.id, { sentToAgent: true, agentSent: true });
  res.json({ queued: true, already });
});
```

The UI is just a button that calls this and then reflects `agentSent` state.

### Part C — The read/ack API (the queue's whole surface area)

Three endpoints, protected by a **bearer token** (not your normal user login —
this is a machine client). Keep it tiny:

```js
// GET /api/agent-queue        — list what's queued
router.get('/', (req, res) => {
  const items = db.getAll()
    .filter(t => t.sentToAgent && t.status === 'active')
    .map(t => ({ id: t.id, title: t.title, description: t.description || '' }));
  db.setSetting('agentQueueLastHeartbeat', new Date().toISOString()); // see §5
  res.json({ count: items.length, items });
});

// POST /api/agent-queue/:id/done — remove an item once it's built
router.post('/:id/done', (req, res) => {
  const item = db.getById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.update(req.params.id, { sentToAgent: false }); // clears in-queue; leaves agentSent
  res.json({ ok: true });
});
```

**Auth — bearer token, constant-time compared:**

```js
function requestToken(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : (req.headers['x-api-key'] || '');
}
function tokenMatches(input) {
  const token = process.env.AGENT_QUEUE_TOKEN || '';
  if (!token || !input) return false;
  const a = Buffer.from(input), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b); // avoid length/timing leaks
}
// Gate the /api/agent-queue routes on tokenMatches(requestToken(req)).
```

Set `AGENT_QUEUE_TOKEN` as an env var on the host **and** in the local agent's
`.env` — the two must match. Generate it with `openssl rand -base64 32`. Never
print it, never commit it.

> **Multi-user note (skip if single-user):** if your app is multi-tenant, decide
> whether the queue is *global* (the developer building the app should see every
> teammate's request) or *per-user*. The working implementation makes the
> token-authenticated pull **global** but a normal signed-in session **per-user**,
> by checking "was this request authenticated by the queue token vs. a user
> session?" and scoping accordingly.

### Part D — The local puller (thin CLI the agent calls)

A ~60-line script the agent shells out to. It just wraps the API so the agent
never handles tokens or URLs directly:

```
node scripts/agent-queue.js list          # human-readable (default)
node scripts/agent-queue.js list --json    # machine-readable, for the agent
node scripts/agent-queue.js done <id>      # ack an item
```

```js
#!/usr/bin/env node
require('dotenv').config();
const BASE  = (process.env.HOSTED_URL || 'https://YOUR-APP.example.com').replace(/\/+$/, '');
const TOKEN = process.env.AGENT_QUEUE_TOKEN || '';
if (!TOKEN) { console.error('AGENT_QUEUE_TOKEN not set'); process.exit(1); }

async function api(path, method = 'GET') {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 401) { console.error('401 — token mismatch vs. host'); process.exit(1); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`${method} ${path} → ${res.status}`); process.exit(1); }
  return data;
}
const [cmd, arg] = process.argv.slice(2);
(async () => {
  if (cmd === 'done')      { await api(`/api/agent-queue/${encodeURIComponent(arg)}/done`, 'POST'); console.log('✓ acked', arg); }
  else /* list */          { const d = await api('/api/agent-queue');
    if (process.argv.includes('--json')) console.log(JSON.stringify(d, null, 2));
    else d.items.forEach((t, i) => console.log(`[${i+1}] ${t.id}\n    ${t.title}\n    ${t.description}\n`)); }
})();
```

Running the agent locally (not on the host) is deliberate: the agent needs a full
working checkout, the ability to run/verify the app, and push rights — all of
which live naturally on a dev machine, not a web dyno.

---

## 3. The scheduled worker (the part that makes it autonomous)

A scheduled task on the dev machine runs an agent prompt on a cadence. In the
reference implementation this is a Claude Code scheduled task; any scheduler that
can invoke an agent with a fixed prompt works.

**Cadence (the actual production value):**

```
cron:  0 7,10,13,16,19,22 * * *     # every 3 hours, 7am–10pm local time
```

- **Every 3 hours during waking hours** is the sweet spot: responsive enough that
  requests land the same day, sparse enough that it isn't churning on an empty
  queue. Tune to taste — hourly if you queue a lot, twice a day if rarely.
- **Bounded to daytime** so it isn't burning agent time overnight.
- **Add jitter** (a random offset of a few minutes) if your scheduler supports it,
  so runs don't align to exact clock ticks.

**The worker prompt** — this is the heart of it. Structure it as explicit steps.
Generalized from the production version:

```
Autonomous worker for <APP>'s agent queue. The user has PRE-AUTHORIZED
implementing and shipping whatever they put in this queue.

Working directory: <ABSOLUTE PATH TO REPO>

STEP 0 — EXPIRY CHECK (do FIRST): This routine self-expires on <DATE>. If today
  is on or after that date, delete this scheduled task and STOP. (See §4.)

STEP 1 — PULL: run `node scripts/agent-queue.js list`. If empty, STOP.

STEP 2 — WORK EACH ITEM, one at a time:
  a. Implement the change. (Describe the stack briefly so the agent matches
     conventions: e.g. "Node/Express under server/, vanilla JS under public/.")
  b. VERIFY before shipping — start the app and confirm the change works and
     there are no console/server errors, or run the relevant checks. Do not
     ship on faith.
  c. Commit with a clear message; end it with your Co-Authored-By trailer;
     `git push origin main`.
  d. Ack it: `node scripts/agent-queue.js done <id>`.
  e. If an item is already implemented (duplicate), just ack it — don't redo it.

STEP 3 — SAFETY (see §4): SKIP (leave queued, do NOT ack) anything ambiguous,
  destructive, secret-touching, permission-changing, or with irreversible
  external side effects. In your summary, list what you shipped and what you
  skipped and why.

Never print or commit .env or any secret. Keep commits scoped to one item each.
```

Two properties make this reliable:

1. **Verify-before-ship.** The agent runs the app and checks its own work. An item
   only leaves the queue after it's confirmed working and pushed. This single rule
   is the difference between "usually works" and "trust it unattended."
2. **One item = one commit.** Scoped commits keep history reviewable and make it
   trivial to revert a single bad change without unwinding a batch.

---

## 4. Safety rails (do not skip this section)

An agent that can commit and push unattended needs hard limits. Two mechanisms:

**(a) A refuse-list baked into the prompt.** The worker must SKIP — leave in the
queue, never ack — any item that is:

- **ambiguous / underspecified** (it can't know your intent → don't guess),
- **destructive** (deletes data, `git reset --hard`, force-push, `rm -rf`),
- **secret- or credential-touching**,
- **permission / access-changing**,
- **irreversibly outward-facing** (sending email/messages, purchases, publishing).

Skipped items surface in the run summary, so you see them and can handle them
yourself or reword the request. "When in doubt, leave it in the queue" is the
correct default.

**(b) A hard self-expiry.** The scheduled task carries an expiry date and, as its
very first step, deletes itself once that date passes. This bounds the blast
radius of an unattended agent: even if you forget it exists, it stops on its own
after ~2 weeks. Renewing is a deliberate act (re-create the schedule, bump the
date), which forces a periodic "do I still want this running?" check. **Always
give an autonomous, self-directed schedule an expiry.**

---

## 5. Monitoring (optional but recommended)

Because the worker runs off on its own, add a cheap liveness signal so a silently
dead worker (expired, disabled, machine off) doesn't leave requests rotting
unnoticed:

- **Heartbeat:** the `GET /api/agent-queue` list endpoint stamps a
  "last checked in" timestamp every time it's hit (it's only ever called by the
  worker). See the `setSetting(...)` line in Part C.
- **Surface it in-app:** an owner-only banner that warns if (a) the last heartbeat
  is older than your cadence + a margin (e.g. cadence is 3h → warn after ~20h of
  silence), or (b) the known self-expiry date is within a few days. A `GET
  /status` endpoint returning `{ lastHeartbeatAt, expiresAt }` is enough to drive
  it.

This closes the loop: you flag work and forget it, *and* you're told if the thing
that's supposed to be building it has gone quiet.

---

## 6. Adoption checklist

1. [ ] Add two boolean columns to an existing table: `sent_to_agent`,
       `agent_sent` (§2A).
2. [ ] Add the enqueue endpoint + a "Send to agent" button wired to it (§2B).
       Drive the button's state off `agent_sent`.
3. [ ] Add the `list` / `:id/done` endpoints, gated on a bearer token (§2C).
4. [ ] Generate `AGENT_QUEUE_TOKEN`; set it on the host and in the local `.env`
       (same value). `openssl rand -base64 32`.
5. [ ] Drop in the `scripts/agent-queue.js` puller; confirm `list` and `done`
       work against the host (§2D).
6. [ ] Write the worker prompt with your stack details, verify step, safety
       rails, and an **expiry date** (§3, §4).
7. [ ] Create the scheduled task with your chosen cadence (start with
       `0 7,10,13,16,19,22 * * *`).
8. [ ] (Recommended) add the heartbeat stamp + an in-app staleness/expiry warning
       (§5).
9. [ ] Queue one small, unambiguous item and watch a full cycle: flag → next run
       builds + pushes + acks → button shows "Sent ✓".

---

## 7. Common pitfalls (especially if you've struggled with this before)

- **Button re-enables and resubmits.** You keyed it off the in-queue flag. Use the
  separate "ever sent" flag for UI state (§2A).
- **Agent ships broken changes.** Your prompt lacks a mandatory verify-before-ack
  step, or the agent can't actually run your app. Make "start it and confirm, or
  run the checks" a hard step, and make sure the dev machine can run the app.
- **Agent runs on the host and can't build anything.** Run it on a dev machine
  with a real checkout, run/verify tooling, and push rights — not on the web host.
- **401 from the puller.** The token in the local `.env` doesn't match the host's.
  They must be identical; a trailing space or wrong environment is the usual cause.
- **Items silently pile up.** The worker expired, is disabled, or the machine was
  off. That's what the heartbeat warning (§5) is for.
- **You're nervous about autonomy.** Good — lean on the refuse-list and the hard
  self-expiry (§4). Start with a short expiry and a conservative cadence; widen
  once you trust it.
- **Stale front-end after a deploy** (if you have a service worker). Make it
  network-first, or have the verify step unregister the SW and hard-reload, so the
  agent doesn't "verify" against cached old code.

---

## 8. Minimal variant (no hosted DB)

If your app has no server/DB, the same shape still works with the queue as a
tracked file: a `AGENT_QUEUE.md` (or `.jsonl`) in the repo where the "enqueue"
action appends a line and the worker reads/edits it. You lose remote capture
(you can only queue from a machine with the repo) and cross-device flagging, but
you keep the decoupling, the scheduled worker, verify-before-ship, one-commit-
per-item, safety rails, and self-expiry. The hosted-DB version exists precisely to
regain remote/multi-device capture — that's the main thing it buys you over the
file.

---

*Provenance: distilled from a working production implementation (a personal task
app whose "Send to Claude" queue is built unattended by a Claude Code scheduled
task every 3 hours). Names generalized; mechanics unchanged.*
