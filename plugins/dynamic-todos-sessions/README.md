# dynamic-todos-sessions

A Claude Code mod that files each Claude Code session as a task in Dynamic Todos.

- **Each session gets a task named exactly what Claude calls the session** (the name in the desktop app's left panel, e.g. "CPB billing"). Rename the session and the task follows at your next prompt. Before Claude has named a new session, a short AI-written title stands in. Tasks go inside the agent named for the computer you're on, e.g. "Gaming PC", which is created if it isn't there yet. Like any new task in an agent, it starts with your default follow-up alarm.
- **A prompt that starts a clearly different task** renames the task to match (a quick check by Claude's small Haiku model; follow-ups and prompts under six words are never renamed). The Claude session gets the same new name at your next prompt, so the two still match. If you rename the session yourself in the meantime, your name wins.
- **Within 3 hours of your last prompt on it**, a task carries on: further prompts in the session, a `/clear`, or another session with the same name join it. After 3 quiet hours, your next prompt starts a fresh task (with the same name).
- **Each turn Claude finishes** adds one timestamped line to that task and sets its follow-up alarm off straight away: Claude is waiting on you.
- **Claude stopping mid-turn to ask you something** (a permission prompt, a question) sets the alarm off too, with no line.
- **Answering** (your next prompt, the permission, the question) stops the ringing; the alarm goes back to waiting (bell lit) while Claude works.

An open Dynamic Todos page notices within about 5 seconds and rings. The page needs a click or a keypress since it loaded before the browser lets it make sound.

Dynamic Todos does the filing (`cheviot-work-hub/server/routes/claudeSessions.js`). The mod only reports, and never holds up a prompt. It works in Claude Code (the terminal and the desktop Code tab), not in claude.ai chats.

## Set up on a computer

In Dynamic Todos, open the ⚙ menu, then **Connect a computer to Claude Code**. Optionally name the computer, press **Get the line**, and paste the line it shows into a terminal on that computer (or paste it into Claude there and ask it to run it). Then restart Claude.

The line works once, for 30 minutes. It installs this mod from the public `jmwmllc/claude-skills` marketplace and gives it that computer's own key, which only works for filing Claude Code sessions. It finds Claude whether it's the desktop app or the command-line tool. Run a new line any time to reconnect or rename.

## Develop

```bash
claude plugin validate claude-mods/dynamic-todos-sessions
```

```bash
claude plugin test claude-mods/dynamic-todos-sessions
```
