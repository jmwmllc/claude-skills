# jmwmllc Claude Code skills

A Claude Code **plugin marketplace** for skills shared across the team. Anyone
can install it — you don't need to be on the same GitHub account or org.

## Install (each teammate, once)

In Claude Code, run:

```
/plugin marketplace add jmwmllc/claude-skills
/plugin install jmwmllc@claude-skills
/reload-plugins          # REQUIRED — activates the plugin in your session
```

The `/reload-plugins` step is easy to skip but essential — without it you'll get
"Unknown command" when you try to use the skill.

Updates arrive automatically as new commits are pushed here; to force a refresh,
run `/plugin marketplace update claude-skills` (then `/reload-plugins`).

## Using a skill

Once installed and reloaded, either:

- type the slash command, e.g. `/jmwmllc:feedback-mode`, **or**
- just ask in plain language, e.g. *"add feedback mode to this project"* — the
  skills are model-invoked too, so Claude picks the right one from its description.

If a slash command reports "Unknown command", run `/reload-plugins`, and check
`/plugin list` shows `jmwmllc` as enabled.

## What's included

### `feedback-mode`  →  invoke as `/jmwmllc:feedback-mode`

Installs a **dev-only, framework-agnostic in-browser feedback widget** into any
web project: a toggle in the corner, drag a bounding box over any element, type
or dictate a note, and it ships — with the box coordinates, the DOM element under
it, the route, and a project ID — to a central mission-control dashboard (or a
local queue while that dashboard is being built).

Ask Claude something like *"add feedback mode to this project"* once the plugin
is installed.

### `agent-queue`  →  invoke as `/jmwmllc:agent-queue`

Sets up an **autonomous agent work queue** in a project: a "send to agent" flag
in the app, a small bearer-token-authenticated list/ack API, a thin local puller
script, and a scheduled coding agent (e.g. Claude Code) that wakes every few
hours to build, **verify**, commit, push, and ack each queued task — with hard
safety rails and a self-expiry. It's the generalized version of this team's
"Send to Claude" queue; the skill carries the full spec as reference material.

Ask Claude something like *"set up an agent work queue in this project"* or
*"I want to queue tasks and have an agent build them automatically"*.

## Repo layout

```
.claude-plugin/marketplace.json   # marketplace manifest (lists the plugin)
plugins/jmwmllc/
├── .claude-plugin/plugin.json     # plugin manifest
└── skills/
    ├── feedback-mode/            # the skill (SKILL.md + assets + references)
    └── agent-queue/             # the skill (SKILL.md + references/spec)
```

To add more skills later, drop another folder under
`plugins/jmwmllc/skills/<new-skill>/` and push — installed teammates get it on
their next update.
