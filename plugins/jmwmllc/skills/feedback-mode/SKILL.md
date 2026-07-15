---
name: feedback-mode
description: >-
  Install a dev-only, in-browser visual feedback capture widget into a web
  project. It adds a green/gray toggle that lets you drag a bounding box over any
  element and dictate or type a note, which is shipped (with the box coords, the
  DOM element under it, the route, and a project ID) to a central "mission
  control" dashboard — or a local queue while that dashboard is being built. Use
  this skill whenever the user wants to add a feedback mechanism, a "feedback
  mode", visual/click-to-comment bug reporting, a way to annotate the UI while
  developing, or to wire a project into their mission control feedback pipeline —
  even if they don't name the widget explicitly. This skill INSTALLS the capture
  tool; it does not triage, approve, or apply the feedback (mission control and
  the junior devs own that).
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

**Scope boundary — important.** This skill's job ends at *capture and ship*. It
must NOT build triage UI, auto-apply changes, or open PRs from the queue. Acting
on feedback is owned by mission control and the junior developers. If the user
asks for that here, gently point out it belongs on the mission-control side and
keep this install focused on capture.

## The pieces (bundled in `assets/`)

- **`feedback-widget.js`** — the whole widget: toggle, box-drawing, popup,
  Web Speech transcription, and the POST. Framework-agnostic, no dependencies,
  injects its own CSS. Copy it into the project as-is; don't rewrite it.
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

## Configuration reference

`window.FEEDBACK_CONFIG` (all optional except you'll almost always set `projectId`):

| key         | purpose                                                        |
|-------------|----------------------------------------------------------------|
| `projectId` | routing key for mission control (default `"unknown-project"`)  |
| `endpoint`  | where entries POST (default local `http://localhost:5599/__feedback`) |
| `reporter`  | who's filing notes, if more than just the owner ever will      |

## When the user is building mission control

Read `references/payload-contract.md` and have the dashboard's ingest accept that
exact JSON shape. The `version` field exists so the payload can grow later
(e.g. adding a cropped screenshot) without breaking older senders — add fields,
never repurpose existing ones.
