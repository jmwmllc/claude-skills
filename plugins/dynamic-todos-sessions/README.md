# dynamic-todos-sessions

A Claude Code mod that files each Claude Code session as a task in Dynamic Todos.

- **Each session gets one task, titled for the work** in a few words (by Claude's small Haiku model). Dynamic Todos shows the computer and session after the title, so you can find it in Claude: "Megan Helfand rebalance (Black Tape Mac · CPP1)" for a session named "CPP1:idle". Your session's name is never changed. Tasks go inside the agent named for the computer you're on, e.g. "Gaming PC", which is created if it isn't there yet. Like any new task in an agent, it starts with your default follow-up alarm.
- **When the work moves on to something clearly different**, the task's title follows it (follow-ups and prompts under six words are never checked). A title you change yourself in Dynamic Todos is kept.
- **A session keeps its task until you mark it done**, however long it sits quiet. After that, its next prompt starts a new task. A `/clear`, or another session with the same name, carries on the same task. Delete the task and that session files nothing more.
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
