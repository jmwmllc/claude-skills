---
name: feedback-mode
description: >-
  Install the per-app developer feedback system into a web project. Two pieces: a
  dev-only visual capture widget (a green/gray toggle to drag a bounding box over
  any element and type or dictate a note, shipped with DOM context + route +
  project ID to a central "mission control" dashboard) AND an Admin panel (an
  upper-right Admin button that opens a control panel scoped to that app, reading
  its feedback back from mission control and triaging it). Use this skill whenever
  the user wants to add a feedback mechanism, a "feedback mode", visual/
  click-to-comment bug reporting, a way to annotate the UI while developing, an
  in-app admin or triage panel, or to wire a project into their mission control
  feedback pipeline — even if they don't name the widget explicitly. The pieces
  are client-side; mission control remains the system of record they talk to.
---

# Feedback mode

## What this does

Adds a lightweight, self-contained feedback widget to a web project so the
developer can, while the app runs, flip on "feedback mode", **drag a box around
anything on the page**, and leave a note (typed or spoken). Each note is captured
with enough context — the exact DOM element, the page route, a project ID — that
whoever acts on it later knows precisely what and where. Notes are POSTed to a
central **mission control** dashboard the user is building; until that endpoint
exists, they land in a local `feedback/queue.jsonl` so the tool is useful today.

The skill also installs the **Admin panel** — a per-app, embedded triage surface
(the "Satellite" from mission control's spec). An upper-right Admin button opens a
control panel scoped to that app, showing its feedback (read from mission control)
with triage actions.

**Scope boundary.** This skill installs the *client-side* pieces (capture widget +
admin panel). The admin panel reads and triages feedback **through mission
control's API** (`GET`/`PATCH`) — it does not store feedback, run its own backend,
or apply code changes itself. Mission control stays the system of record; the
panel is a thin per-app client of it.

## The pieces (bundled in `assets/`)

- **`feedback-widget.js`** — the capture widget: toggle, box-drawing, popup,
  Web Speech transcription, and the POST. Framework-agnostic, no dependencies,
  injects its own CSS. Copy it in as-is; don't rewrite it.
- **`admin-panel.js`** — the per-app Admin panel: upper-right Admin button, no-op
  password gate, a list of *this app's* feedback read from mission control, and
  triage buttons that `PATCH` state back. Same self-contained vanilla-JS shape;
  reuses `FEEDBACK_CONFIG`. Copy it in as-is.
- **`feedback-server.js`** — a tiny zero-dependency Node collector for the local
  fallback. Only needed until mission control's endpoint is live.
- **`references/payload-contract.md`** — the exact JSON each entry sends. Read it
  when the user is building mission control's ingest, or when they ask what data
  a note carries.

## Installing into a project

Adapt paths to the project's conventions, but keep these steps:

1. **Copy the widget** into the project's dev/source tree, e.g.
   `src/dev/feedback-widget.js` (Vite/React) or `public/feedback-widget.js`
   (plain static site). Verify afterward that the copied file is byte-identical
   to the asset — it's a finished component, not a starting point.

2. **Load it behind a dev-only guard** so it can never reach production users.
   Pick the form that matches the stack:
   - Vite / most bundlers:
     ```js
     if (import.meta.env.DEV) {
       window.FEEDBACK_CONFIG = { projectId: "<project-id>" };
       import("./dev/feedback-widget.js");
     }
     ```
   - Create React App / `process.env`:
     ```js
     if (process.env.NODE_ENV === "development") {
       window.FEEDBACK_CONFIG = { projectId: "<project-id>" };
       import("./dev/feedback-widget");
     }
     ```
   - Plain HTML: add the tag to the dev page only (not the production build):
     ```html
     <script>window.FEEDBACK_CONFIG = { projectId: "<project-id>" };</script>
     <script src="/feedback-widget.js"></script>
     ```
   Use the repo name as `<project-id>` unless the user says otherwise — it is the
   routing key mission control uses to reach the right junior dev.

3. **Point it at a destination.** If mission control's endpoint exists, set it:
   `window.FEEDBACK_CONFIG = { projectId, endpoint: "https://…/api/feedback" }`.
   If not, leave `endpoint` unset (it defaults to the local collector) and set up
   the fallback: copy `feedback-server.js` to the project, add a script such as
   `"feedback": "node feedback-server.js"`, and tell the user to run it in a spare
   terminal (`npm run feedback`). Add `feedback/` to `.gitignore` — captured notes
   are local scratch, not source.

4. **Confirm the guard.** Double-check the import truly can't run in a production
   build (the `DEV`/`NODE_ENV` check is real, or the script tag is absent from the
   prod HTML). This is the one thing that must not be gotten wrong.

5. **Tell the user how to use it:** run the dev server (and the feedback server if
   using the fallback), open the app, click the **Feedback** toggle top-right so it
   turns green, drag a box, type or speak a note, hit Enter or Submit. Note that
   live voice transcription needs a Chromium browser (Chrome/Edge); typing works
   everywhere.

## Installing the Admin panel (the embedded "Satellite")

`admin-panel.js` gives the app an upper-right **Admin** button → a no-op password
gate → a panel showing *this app's* feedback (read from mission control) with
triage actions. It reuses the same `FEEDBACK_CONFIG` (`projectId` + `endpoint`) as
the capture widget — the `endpoint` is the mission-control feedback URL, which the
panel calls as `GET endpoint?projectId=…` and `PATCH endpoint/:id`.

1. **Copy** `admin-panel.js` into the same dev/source tree as the widget
   (e.g. `src/dev/admin-panel.js`), byte-identical.
2. **Its gating differs from the capture widget and depends on whether the app is
   publicly reachable:**
   - **Internal / auth-gated apps** (team-only tools, or sites behind an auth
     gate): load the panel **always, including production**, so devs can triage
     from the live site. Move `FEEDBACK_CONFIG` *out* of any `DEV` guard so it's
     set in prod too, keep the capture widget dev-only, and import the panel
     unconditionally.
   - **Genuinely public, end-user-facing apps** (e.g. a game with real players):
     load the panel **dev-only** (`import.meta.env.DEV` / localhost), exactly like
     the capture widget, so visitors never see or mutate feedback.
3. **The password is a NO-OP placeholder** — submitting (even empty) opens the
   panel; it enforces nothing today, and mission control's API is currently
   unauthenticated. That is *why* public apps must keep the panel dev-only until
   real auth (GitHub OAuth) lands. Never load the panel on a public site with the
   no-op gate.

Example — internal/auth-gated app (Vite):

```js
window.FEEDBACK_CONFIG = { projectId: "<project-id>", endpoint: "https://<mc>/api/feedback" };
if (import.meta.env.DEV) import("./dev/feedback-widget.js"); // capture: dev-only
import("./dev/admin-panel.js");                              // admin: live on internal apps
```

If TypeScript flags the `.js` import, add a one-line `admin-panel.d.ts`
(`export {}`) next to it, same as the widget's.

## Configuration reference

`window.FEEDBACK_CONFIG` — shared by the capture widget and the admin panel
(all optional except you'll almost always set `projectId`):

| key         | purpose                                                        |
|-------------|----------------------------------------------------------------|
| `projectId` | routing key for mission control (default `"unknown-project"`); the admin panel also filters its list by it |
| `endpoint`  | where entries POST *and* what the admin panel reads/triages from (default local `http://localhost:5599/__feedback`) |
| `reporter`  | who's filing notes, if more than just the owner ever will      |

## When the user is building mission control

Read `references/payload-contract.md` and have the dashboard's ingest accept that
exact JSON shape. The `version` field exists so the payload can grow later
(e.g. adding a cropped screenshot) without breaking older senders — add fields,
never repurpose existing ones.
