/*
 * feedback-widget.js — dev-only, framework-agnostic in-browser feedback capture.
 *
 * Self-contained: injects its own CSS, has zero dependencies, and works in any
 * web page (React, Vue, plain HTML, whatever) because it only touches the DOM.
 *
 * Configure (optional) by setting window.FEEDBACK_CONFIG BEFORE this file runs:
 *   window.FEEDBACK_CONFIG = {
 *     projectId: "film-dashaudiosync",              // routes the note in mission control
 *     endpoint:  "https://mission-control/api/feedback", // where entries are POSTed
 *     reporter:  "jim"                              // optional, who filed it
 *   };
 * If `endpoint` is omitted it falls back to the local dev collector
 * (http://localhost:5599/__feedback, see feedback-server.js) so it works before
 * mission control exists.
 *
 * IMPORTANT: this is a development tool. Never ship it to production users —
 * load it behind a dev-only guard (see the skill's install instructions).
 */
(function () {
  if (window.__feedbackWidgetLoaded) return; // idempotent: safe to import twice
  window.__feedbackWidgetLoaded = true;

  var cfg = window.FEEDBACK_CONFIG || {};
  var PROJECT_ID = cfg.projectId || "unknown-project";
  var ENDPOINT = cfg.endpoint || "http://localhost:5599/__feedback";
  var REPORTER = cfg.reporter || null;
  var STORAGE_KEY = "__feedbackModeOn";
  var CONTRACT_VERSION = 1;

  /* ------------------------------------------------------------------ styles */
  var css = [
    "#__fb_toggle{position:fixed;top:14px;right:14px;z-index:2147483646;display:flex;",
    "align-items:center;gap:8px;font:600 12px/1 system-ui,sans-serif;color:#374151;",
    "background:#fff;border:1px solid #e5e7eb;border-radius:999px;padding:6px 10px 6px 12px;",
    "box-shadow:0 2px 8px rgba(0,0,0,.12);cursor:pointer;user-select:none}",
    "#__fb_toggle .sw{position:relative;width:38px;height:22px;border-radius:999px;",
    "background:#cbd5e1;transition:background .18s}",
    "#__fb_toggle .sw::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;",
    "border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s}",
    "#__fb_toggle.on .sw{background:#22c55e}",
    "#__fb_toggle.on .sw::after{transform:translateX(16px)}",
    "#__fb_capture{position:fixed;inset:0;z-index:2147483640;cursor:crosshair;display:none}",
    "body.__fb_active #__fb_capture{display:block}",
    "#__fb_rect{position:fixed;z-index:2147483641;border:2px solid #22c55e;",
    "background:rgba(34,197,94,.12);pointer-events:none;display:none}",
    "#__fb_pop{position:fixed;z-index:2147483645;width:300px;max-width:90vw;background:#fff;",
    "border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);",
    "padding:12px;display:none;font:14px/1.4 system-ui,sans-serif;color:#111}",
    "#__fb_pop textarea{width:100%;min-height:70px;resize:vertical;border:1px solid #d1d5db;",
    "border-radius:8px;padding:8px;font:inherit;box-sizing:border-box}",
    "#__fb_pop .row{display:flex;align-items:center;gap:8px;margin-top:8px}",
    "#__fb_pop button{font:600 13px/1 system-ui,sans-serif;border:0;border-radius:8px;",
    "padding:8px 12px;cursor:pointer}",
    "#__fb_mic{background:#f1f5f9;color:#334155;width:36px;height:34px;display:flex;",
    "align-items:center;justify-content:center;font-size:16px}",
    "#__fb_mic.rec{background:#fee2e2;color:#dc2626;animation:__fb_pulse 1.2s infinite}",
    "@keyframes __fb_pulse{0%,100%{opacity:1}50%{opacity:.5}}",
    "#__fb_submit{background:#22c55e;color:#fff;flex:1}",
    "#__fb_cancel{background:transparent;color:#6b7280}",
    "#__fb_hint{font-size:11px;color:#9ca3af;margin-top:6px}",
    "#__fb_toast{position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#111;",
    "color:#fff;padding:10px 14px;border-radius:8px;font:13px system-ui;opacity:0;",
    "transform:translateY(8px);transition:all .2s;pointer-events:none}",
    "#__fb_toast.show{opacity:1;transform:translateY(0)}"
  ].join("");
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ------------------------------------------------------------------ nodes */
  function el(tag, id, html) {
    var n = document.createElement(tag);
    if (id) n.id = id;
    if (html != null) n.innerHTML = html;
    return n;
  }
  var toggle = el("div", "__fb_toggle", "<span>Feedback</span><span class='sw'></span>");
  var capture = el("div", "__fb_capture");
  var rect = el("div", "__fb_rect");
  var pop = el("div", "__fb_pop",
    "<textarea id='__fb_text' placeholder='Describe the change… (speaking is transcribed live)'></textarea>" +
    "<div class='row'><button id='__fb_mic' title='Toggle mic'>&#127908;</button>" +
    "<button id='__fb_submit'>Submit</button>" +
    "<button id='__fb_cancel'>Cancel</button></div>" +
    "<div id='__fb_hint'>Enter to submit · Shift+Enter for a new line · Esc to cancel</div>");
  var toast = el("div", "__fb_toast");
  [toggle, capture, rect, pop, toast].forEach(function (n) { document.body.appendChild(n); });

  var textEl = pop.querySelector("#__fb_text");
  var micBtn = pop.querySelector("#__fb_mic");

  /* ------------------------------------------------------------- mode state */
  function setMode(on) {
    document.body.classList.toggle("__fb_active", on);
    toggle.classList.toggle("on", on);
    try { localStorage.setItem(STORAGE_KEY, on ? "1" : "0"); } catch (e) {}
    if (!on) resetSelection();
  }
  toggle.addEventListener("click", function () {
    setMode(!document.body.classList.contains("__fb_active"));
  });
  var startOn = false;
  try { startOn = localStorage.getItem(STORAGE_KEY) === "1"; } catch (e) {}
  setMode(startOn);

  /* --------------------------------------------------------------- drawing */
  var drag = null;       // {x,y}
  var currentBox = null; // {x,y,width,height}

  capture.addEventListener("mousedown", function (e) {
    if (pop.style.display === "block") return;
    drag = { x: e.clientX, y: e.clientY };
    Object.assign(rect.style, { display: "block", left: e.clientX + "px", top: e.clientY + "px", width: "0px", height: "0px" });
  });
  window.addEventListener("mousemove", function (e) {
    if (!drag) return;
    var x = Math.min(e.clientX, drag.x), y = Math.min(e.clientY, drag.y);
    var w = Math.abs(e.clientX - drag.x), h = Math.abs(e.clientY - drag.y);
    Object.assign(rect.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
  });
  window.addEventListener("mouseup", function (e) {
    if (!drag) return;
    var x = Math.min(e.clientX, drag.x), y = Math.min(e.clientY, drag.y);
    var w = Math.abs(e.clientX - drag.x), h = Math.abs(e.clientY - drag.y);
    drag = null;
    if (w < 6 || h < 6) { resetSelection(); return; } // ignore stray clicks
    currentBox = { x: x, y: y, width: w, height: h, pageX: x + window.scrollX, pageY: y + window.scrollY };
    openPopup(x, y, w, h);
  });

  /* ---------------------------------------------------- element under box */
  function cssPath(node) {
    if (!node || node.nodeType !== 1) return "";
    var parts = [];
    while (node && node.nodeType === 1 && parts.length < 6) {
      var sel = node.nodeName.toLowerCase();
      if (node.id) { parts.unshift(sel + "#" + cssEscape(node.id)); break; }
      var parent = node.parentNode;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.nodeName === node.nodeName; });
        if (siblings.length > 1) sel += ":nth-of-type(" + (Array.prototype.indexOf.call(siblings, node) + 1) + ")";
      }
      parts.unshift(sel);
      node = node.parentNode;
    }
    return parts.join(" > ");
  }
  function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }

  function targetAt(box) {
    // The capture layer sits on top; disable it briefly so we read the real page.
    capture.style.pointerEvents = "none";
    var node = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    capture.style.pointerEvents = "";
    if (!node) return null;
    var attrs = {};
    ["id", "class", "href", "src", "alt", "aria-label", "data-testid"].forEach(function (a) {
      var v = node.getAttribute && node.getAttribute(a);
      if (v) attrs[a] = v;
    });
    return {
      selector: cssPath(node),
      tag: node.nodeName,
      text: (node.textContent || "").trim().slice(0, 160),
      attributes: attrs
    };
  }

  /* ---------------------------------------------------------------- popup */
  function openPopup(x, y, w, h) {
    textEl.value = "";
    var px = Math.min(x, window.innerWidth - 316);
    var py = Math.min(y + h + 8, window.innerHeight - 190);
    Object.assign(pop.style, { display: "block", left: Math.max(8, px) + "px", top: Math.max(8, py) + "px" });
    textEl.focus();
    startMic();
  }
  function resetSelection() {
    rect.style.display = "none";
    pop.style.display = "none";
    currentBox = null;
    stopMic();
  }

  /* ----------------------------------------------------- speech-to-text */
  var recog = null, recognizing = false;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { micBtn.style.display = "none"; }

  function startMic() {
    if (!SR) return;
    try {
      recog = new SR();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = navigator.language || "en-US";
      var base = "";
      recog.onstart = function () { recognizing = true; micBtn.classList.add("rec"); base = textEl.value ? textEl.value + " " : ""; };
      recog.onend = function () { recognizing = false; micBtn.classList.remove("rec"); };
      recog.onerror = function () { recognizing = false; micBtn.classList.remove("rec"); };
      recog.onresult = function (ev) {
        var out = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) out += ev.results[i][0].transcript;
        textEl.value = base + out;
      };
      recog.start();
    } catch (e) { /* mic unavailable — typing still works */ }
  }
  function stopMic() { if (recog && recognizing) { try { recog.stop(); } catch (e) {} } }
  micBtn.addEventListener("click", function () { recognizing ? stopMic() : startMic(); });

  /* ---------------------------------------------------------------- submit */
  function submit() {
    if (!currentBox) return;
    var entry = {
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
      projectId: PROJECT_ID,
      reporter: REPORTER,
      notes: textEl.value.trim(),
      box: currentBox,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      target: targetAt(currentBox),
      url: location.href,
      route: location.pathname,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      source: "feedback-mode-widget",
      version: CONTRACT_VERSION
    };
    stopMic();
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    }).then(function (r) {
      showToast(r.ok ? "Feedback sent ✓" : "Sent, but server returned " + r.status);
    }).catch(function () {
      showToast("Couldn't reach collector — is the feedback server running?");
    });
    resetSelection();
  }
  pop.querySelector("#__fb_submit").addEventListener("click", submit);
  pop.querySelector("#__fb_cancel").addEventListener("click", resetSelection);
  textEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === "Escape") { e.preventDefault(); resetSelection(); }
  });

  /* ---------------------------------------------------------------- toast */
  var toastT = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toast.classList.remove("show"); }, 2600);
  }

  console.info("[feedback-mode] loaded for project '" + PROJECT_ID + "' → " + ENDPOINT);
})();
