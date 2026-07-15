/*
 * feedback-server.js — tiny zero-dependency local collector for feedback-mode.
 *
 * Runs alongside your dev server and receives entries POSTed by feedback-widget.js
 * when no mission-control `endpoint` is configured yet. Appends each entry as one
 * line to feedback/queue.json (JSON Lines) so it's easy to tail and append to
 * without rewriting the whole file.
 *
 * Run:   node feedback-server.js
 * Port:  5599 (override with FEEDBACK_PORT)
 * Output: ./feedback/queue.jsonl  (override with FEEDBACK_FILE)
 *
 * This is a DEV tool. Do not run it in production or expose it publicly.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.FEEDBACK_PORT || 5599;
const OUT = process.env.FEEDBACK_FILE || path.join(process.cwd(), "feedback", "queue.jsonl");

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const server = http.createServer((req, res) => {
  // Permissive CORS so the widget can POST from any dev origin/port.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

  if (req.method === "POST" && req.url === "/__feedback") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try {
        const entry = JSON.parse(body);
        entry.receivedAt = new Date().toISOString();
        fs.appendFileSync(OUT, JSON.stringify(entry) + "\n");
        const label = (entry.notes || "").slice(0, 60) || "(no notes)";
        console.log(`[feedback] ${entry.projectId || "?"} · ${entry.route || "?"} · ${label}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, id: entry.id }));
      } catch (e) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: "invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`feedback collector listening on http://localhost:${PORT}/__feedback`);
  console.log(`appending entries to ${OUT}`);
});
