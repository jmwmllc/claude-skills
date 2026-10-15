// The session this mod has logged to Dynamic Todos: which one (a /clear starts
// a new id), and what its task was made from, so a turn can make the task too
// if the first request never landed.
export type Session = { sessionId: string; title: string; prompt: string; folder: string }

declare module 'claude-code' {
  interface PluginState {
    'dynamic-todos-sessions': { session: Session | null }
  }
}
