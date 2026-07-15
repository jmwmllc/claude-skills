# Feedback payload contract (v1)

Every feedback entry is a single JSON object POSTed to the configured `endpoint`
(mission control) or, until that exists, to the local collector at
`http://localhost:5599/__feedback`. Build mission control's ingest to accept
exactly this shape so the widget never has to change per project.

## Schema

```json
{
  "id": "9f1c…",                     // string, unique per entry (UUID)
  "projectId": "film-dashaudiosync", // string, which project — used to ROUTE to the right junior dev
  "reporter": "jim",                 // string|null, who filed it (optional, from config)
  "notes": "Logo is too large on mobile", // string, the typed/transcribed note
  "box": {                            // the bounding box the user dragged
    "x": 120, "y": 80,                // top-left in viewport coordinates (CSS px)
    "width": 200, "height": 60,
    "pageX": 120, "pageY": 380        // top-left in full-page coordinates (includes scroll)
  },
  "viewport": { "width": 1280, "height": 800 },
  "target": {                         // the DOM element under the box's center — the "what"
    "selector": "header > nav > img", // CSS path to re-find it in source
    "tag": "IMG",
    "text": "",                       // trimmed textContent (≤160 chars)
    "attributes": { "class": "logo", "src": "/logo.svg" } // id/class/href/src/alt/aria-label/data-testid if present
  },
  "url": "http://localhost:5173/dashboard",
  "route": "/dashboard",              // pathname only — the page the note is about
  "timestamp": "2026-07-12T10:30:00.000Z", // ISO 8601, when submitted client-side
  "userAgent": "Mozilla/5.0 …",
  "source": "feedback-mode-widget",
  "version": 1                        // contract version — bump if this shape changes
}
```

The local collector adds one field on receipt:

```json
{ "receivedAt": "2026-07-12T10:30:01.200Z" }  // server-side arrival time
```

## Field notes for mission control

- **`projectId`** is the routing key. The widget sets it once per project via
  `window.FEEDBACK_CONFIG.projectId`. Mission control maps `projectId` → the
  junior dev(s) who own that project.
- **`target.selector` + `route`** together pinpoint *what* on *which page*. That
  is enough for a developer (or Claude) to locate the element in source.
- **`box`** is kept for visual disambiguation when a region spans several
  elements (the selector is only the element at the box's center).
- **`version`** lets mission control stay backward-compatible if the payload
  grows later (e.g. adding a screenshot field). Add fields; don't repurpose old ones.

## Local queue format

The fallback collector writes **JSON Lines** — one entry per line — to
`feedback/queue.jsonl`. This is append-only and trivial to tail:

```
{"id":"…","projectId":"…","notes":"…", …}
{"id":"…","projectId":"…","notes":"…", …}
```

Read it line-by-line; each line is one complete entry.
