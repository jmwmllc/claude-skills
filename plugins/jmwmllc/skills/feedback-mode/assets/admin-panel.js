/*
 * admin-panel.js — per-app Admin panel (the embedded "Satellite").
 *
 * Self-contained, zero-dependency vanilla JS (same shape as feedback-widget.js so
 * it folds into the feedback-mode skill). Adds an "Admin" button in the upper
 * right; clicking it opens a control panel scoped to THIS app that reads the app's
 * feedback back from Mission Control and lets you triage it.
 *
 * Reuses window.FEEDBACK_CONFIG (set by the same install):
 *   projectId : which app's feedback to show (routing key)
 *   endpoint  : MC's feedback URL, e.g. https://<mc>/api/feedback
 *               (list = GET endpoint?projectId=..., triage = PATCH endpoint/:id)
 *
 * Access: a password field fronts the panel, but it is a NO-OP placeholder for
 * future real auth — submitting (even empty) opens the panel. Because it enforces
 * nothing, only load this where that's acceptable: on internal / auth-gated apps
 * (live is fine) or dev-only on public apps. See Mission Control SPEC §4.5.
 */
(function () {
  if (window.__adminPanelLoaded) return;
  window.__adminPanelLoaded = true;

  var cfg = window.FEEDBACK_CONFIG || {};
  var PROJECT_ID = cfg.projectId || "unknown-project";
  var ENDPOINT = cfg.endpoint || null; // no endpoint → can't reach MC; panel shows a notice

  var STATES = [
    { key: "new", label: "New" },
    { key: "in_review", label: "In Review" },
    { key: "approved", label: "Approved" },
    { key: "pushed", label: "Pushed" },
    { key: "rejected", label: "Rejected" },
  ];
  var LABELS = STATES.reduce(function (m, s) { m[s.key] = s.label; return m; }, {});
  var unlocked = false;

  /* ---------------------------------------------------------------- styles */
  var css = [
    "#__ap_btn{position:fixed;top:14px;right:128px;z-index:2147483644;display:flex;",
    "align-items:center;gap:6px;font:600 12px/1 system-ui,sans-serif;color:#fff;",
    "background:#4338ca;border:0;border-radius:999px;padding:8px 14px;cursor:pointer;",
    "box-shadow:0 2px 8px rgba(0,0,0,.18)}",
    "#__ap_btn:hover{background:#3730a3}",
    "#__ap_ov{position:fixed;inset:0;z-index:2147483644;background:rgba(15,23,42,.55);",
    "display:none;align-items:flex-start;justify-content:center;padding:40px 16px;",
    "font:14px/1.45 system-ui,sans-serif}",
    "#__ap_ov.show{display:flex}",
    "#__ap_card{background:#fff;color:#0f172a;border-radius:14px;width:720px;max-width:100%;",
    "max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:hidden}",
    "#__ap_head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;",
    "border-bottom:1px solid #e5e7eb}",
    "#__ap_head h2{margin:0;font-size:15px}",
    "#__ap_head .pid{color:#6366f1;font-weight:700}",
    "#__ap_head .btns{display:flex;gap:8px}",
    "#__ap_head button{font:600 12px system-ui;border:1px solid #d1d5db;background:#f8fafc;",
    "border-radius:8px;padding:6px 10px;cursor:pointer}",
    "#__ap_body{padding:16px 18px;overflow:auto}",
    "#__ap_gate{padding:22px 18px;text-align:center}",
    "#__ap_gate input{width:220px;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px;font:inherit;margin:10px auto;display:block}",
    "#__ap_gate .hint{color:#9ca3af;font-size:12px;margin-bottom:12px}",
    "#__ap_gate button{font:600 13px system-ui;border:0;border-radius:8px;padding:9px 18px;cursor:pointer;background:#4338ca;color:#fff}",
    "#__ap_col{margin-bottom:16px}",
    "#__ap_col h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;",
    "display:flex;gap:8px;align-items:center}",
    "#__ap_col .badge{background:#e2e8f0;border-radius:999px;padding:1px 8px;font-size:11px}",
    ".__ap_item{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fff}",
    ".__ap_item .notes{font-size:14px;margin:0 0 6px}",
    ".__ap_item .meta{font-size:11px;color:#64748b;display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px}",
    ".__ap_item code{background:#eef2ff;color:#4338ca;border-radius:5px;padding:1px 5px;font-size:11px}",
    ".__ap_item .acts{display:flex;gap:6px;flex-wrap:wrap}",
    ".__ap_item .acts button{font:600 11px system-ui;border:1px solid #cbd5e1;background:#f8fafc;",
    "border-radius:7px;padding:4px 9px;cursor:pointer;color:#334155}",
    ".__ap_item .acts button:hover{background:#eef2ff;border-color:#a5b4fc}",
    "#__ap_empty{color:#94a3b8;text-align:center;padding:30px}",
    "#__ap_msg{color:#64748b;font-size:12px;padding:4px 0}"
  ].join("");
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------------------------------------------------------------- nodes */
  var btn = document.createElement("button");
  btn.id = "__ap_btn";
  btn.innerHTML = "&#9881; Admin";
  btn.title = "Open the admin panel for " + PROJECT_ID;
  var ov = document.createElement("div");
  ov.id = "__ap_ov";
  ov.innerHTML =
    "<div id='__ap_card'>" +
    "<div id='__ap_head'><h2>Admin · <span class='pid'>" + PROJECT_ID + "</span></h2>" +
    "<div class='btns'><button id='__ap_refresh'>Refresh</button><button id='__ap_close'>Close</button></div></div>" +
    "<div id='__ap_gate'>" +
    "<div>Enter password to open the admin panel</div>" +
    "<input id='__ap_pw' type='password' placeholder='password' autocomplete='off'>" +
    "<div class='hint'>No password needed right now — just click Submit.</div>" +
    "<button id='__ap_submit'>Submit</button></div>" +
    "<div id='__ap_body' style='display:none'></div>" +
    "</div>";
  document.body.appendChild(btn);
  document.body.appendChild(ov);

  var gate = ov.querySelector("#__ap_gate");
  var body = ov.querySelector("#__ap_body");
  var refreshBtn = ov.querySelector("#__ap_refresh");

  /* ---------------------------------------------------------------- open/close */
  function open() { ov.classList.add("show"); if (unlocked) showPanel(); else showGate(); }
  function close() { ov.classList.remove("show"); }
  function showGate() { gate.style.display = "block"; body.style.display = "none"; refreshBtn.style.display = "none"; setTimeout(function () { var p = ov.querySelector("#__ap_pw"); if (p) p.focus(); }, 30); }
  function showPanel() { gate.style.display = "none"; body.style.display = "block"; refreshBtn.style.display = ""; load(); }

  btn.addEventListener("click", open);
  ov.querySelector("#__ap_close").addEventListener("click", close);
  ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  refreshBtn.addEventListener("click", load);

  function submitGate() { unlocked = true; showPanel(); }
  ov.querySelector("#__ap_submit").addEventListener("click", submitGate);
  ov.querySelector("#__ap_pw").addEventListener("keydown", function (e) { if (e.key === "Enter") submitGate(); });

  /* ---------------------------------------------------------------- data */
  function load() {
    if (!ENDPOINT) { body.innerHTML = "<div id='__ap_empty'>No Mission Control endpoint configured for this app.</div>"; return; }
    body.innerHTML = "<div id='__ap_msg'>Loading feedback…</div>";
    fetch(ENDPOINT + "?projectId=" + encodeURIComponent(PROJECT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) { render(d.items || []); })
      .catch(function () { body.innerHTML = "<div id='__ap_empty'>Couldn't reach Mission Control.</div>"; });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  function render(items) {
    if (!items.length) { body.innerHTML = "<div id='__ap_empty'>No feedback for <b>" + PROJECT_ID + "</b> yet.</div>"; return; }
    var html = "";
    STATES.forEach(function (st) {
      var group = items.filter(function (i) { return (i.state || "new") === st.key; });
      if (!group.length) return;
      html += "<div id='__ap_col'><h3>" + st.label + " <span class='badge'>" + group.length + "</span></h3>";
      group.forEach(function (i) {
        var acts = STATES.filter(function (s) { return s.key !== (i.state || "new"); })
          .map(function (s) { return "<button data-id='" + esc(i.id) + "' data-state='" + s.key + "'>" + s.label + "</button>"; }).join("");
        html += "<div class='__ap_item'>" +
          "<p class='notes'>" + (esc(i.notes) || "<em>(no note)</em>") + "</p>" +
          "<div class='meta'><span>" + esc(i.source || "dev") + "</span>" +
          (i.route ? "<span>" + esc(i.route) + "</span>" : "") +
          (i.target && i.target.selector ? "<code>" + esc(i.target.selector) + "</code>" : "") + "</div>" +
          "<div class='acts'>" + acts + "</div></div>";
      });
      html += "</div>";
    });
    body.innerHTML = html;
    Array.prototype.forEach.call(body.querySelectorAll(".acts button"), function (b) {
      b.addEventListener("click", function () { setState(b.getAttribute("data-id"), b.getAttribute("data-state")); });
    });
  }

  function setState(id, state) {
    fetch(ENDPOINT + "/" + encodeURIComponent(id), {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: state })
    }).then(function (r) { if (r.ok) load(); }).catch(function () {});
  }

  console.info("[admin-panel] loaded for '" + PROJECT_ID + "'" + (ENDPOINT ? " → " + ENDPOINT : " (no endpoint)"));
})();
