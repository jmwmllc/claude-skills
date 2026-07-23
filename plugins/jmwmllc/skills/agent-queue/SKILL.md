---
name: agent-queue
description: >-
  Set up an "agent work queue" in a project: a button/flag in the app that queues
  a task, a small bearer-token-authenticated list/ack API, a thin local puller
  script, and a scheduled autonomous coding agent (e.g. Claude Code) that wakes on
  a cadence to build, verify, commit, push, and ack each queued item — with hard
  safety rails and a self-expiry. Use this skill whenever the user wants to send
  tasks/requests to an agent to implement automatically, build a "send to Claude/
  agent" queue, have queued feature requests built unattended on a schedule, set
  up a cron/scheduled worker that pulls a work queue and ships changes, or asks how
  this project's Send-to-Claude queue works so they can reproduce it elsewhere —
  even if they don't name the pattern. Also use it to review/repair an existing
  agent-queue setup that's misbehaving (resubmitting items, shipping broken code,
  items piling up, 401s from the puller).
---

# Agent work queue

## What this does
Installs a battle-tested pattern for letting an autonomous coding agent build
features you request from inside your own app, on a schedule, safely. You flag a
record in your existing DB ("Send to agent"); a tiny authenticated API exposes the
flagged set; a scheduled agent on a dev machine pulls the list every few hours and,
per item, implements the change, **verifies it by running the app**, commits,
pushes, and acks it off the queue. Explicit refuse-rules plus a hard self-expiry
keep the unattended agent fenced.

The full, generalized specification — architecture, reference code for every part,
the real production cadence, safety rails, monitoring, adoption checklist, and a
common-pitfalls guide — lives in **[references/agent-queue-pattern.md](references/agent-queue-pattern.md)**.
Read that file in full before implementing; this SKILL.md is the operating guide
for applying it.

## When to use
- The user wants to queue tasks/requests and have an agent build them automatically.
- They want a "send to Claude/agent" button that leads to shipped code.
- They want a scheduled worker that pulls a queue and commits changes unattended.
- They want to reproduce another project's Send-to-Claude queue.
- They have an agent queue that's broken (see Troubleshooting below).

## How to apply it (new setup)
Work through the reference's **§6 Adoption checklist**, adapting names to the
project. In order:

1. **Queue store** — add TWO boolean columns to an existing record type:
   `sent_to_agent` (in the queue) and `agent_sent` (ever sent). Drive the button's
   "Sent ✓"/disabled state off `agent_sent`, never off `sent_to_agent` — this is
   what prevents accidental resubmission after an ack (reference §2A).
2. **Enqueue** — an idempotent endpoint that flips the flags, plus a button (§2B).
3. **List / ack API** — `GET /api/agent-queue` and `POST /:id/done`, gated on a
   bearer token compared in constant time (§2C). Have the list endpoint stamp a
   "last heartbeat" timestamp for monitoring (§5).
4. **Token** — `AGENT_QUEUE_TOKEN`, generated with `openssl rand -base64 32`, set
   IDENTICALLY on the host and in the local agent's `.env`. Never print/commit it.
5. **Puller** — drop in the ~60-line `scripts/agent-queue.js` (§2D); confirm `list`
   and `done` work against the host.
6. **Worker prompt** — write it with the project's stack details, a MANDATORY
   verify-before-ack step, the safety refuse-list, and an EXPIRY DATE (§3, §4).
7. **Schedule** — create the scheduled task. Start with the proven cadence
   `0 7,10,13,16,19,22 * * *` (every 3h, 7am–10pm local); tune later.
8. **Monitoring (recommended)** — a `GET /status` returning `{ lastHeartbeatAt,
   expiresAt }` and an owner-only in-app banner that warns on staleness/near-expiry
   (§5).
9. **Smoke test** — queue one small, unambiguous item and watch a full cycle:
   flag → next run builds + pushes + acks → button shows "Sent ✓".

## Non-negotiables (do not omit)
- **Two flags**, or the button will resubmit (§2A, §7).
- **Verify-before-ack**: the worker must run the app / run checks and confirm the
  change works before acking. This is the difference between "usually works" and
  "trust it unattended" (§3).
- **One item = one commit** for reviewable, revertible history (§3).
- **Safety refuse-list**: the worker SKIPS (leaves queued, never acks) anything
  ambiguous, destructive, secret-touching, permission-changing, or irreversibly
  outward-facing (§4a).
- **Hard self-expiry**: the scheduled task deletes itself after a set date as its
  first step. Always give a self-directed schedule an expiry (§4b).

## Troubleshooting an existing setup
Map the symptom to the reference's **§7 Common pitfalls**:
- Button re-enables / resubmits → keyed off the wrong flag (§2A).
- Ships broken changes → missing verify step, or the machine can't run the app.
- Puller returns 401 → local `.env` token ≠ host token.
- Items pile up silently → worker expired/disabled/machine off → add the heartbeat
  warning (§5).
- Stale front-end after deploy → service worker serving cached code; make it
  network-first or unregister+hard-reload in the verify step.

## Notes
- Run the agent on a DEV MACHINE with a real checkout, run/verify tooling, and push
  rights — not on the web host.
- No server/DB? Use the file-based minimal variant (reference §8): the queue is a
  tracked `AGENT_QUEUE.md`. You keep the scheduled worker, verify-before-ship,
  safety rails, and self-expiry; you lose only remote/multi-device capture.
