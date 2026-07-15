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

## Repo layout

```
.claude-plugin/marketplace.json   # marketplace manifest (lists the plugin)
plugins/jmwmllc/
├── .claude-plugin/plugin.json     # plugin manifest
└── skills/
    └── feedback-mode/             # the skill (SKILL.md + assets + references)
```

To add more skills later, drop another folder under
`plugins/jmwmllc/skills/<new-skill>/` and push — installed teammates get it on
their next update.
