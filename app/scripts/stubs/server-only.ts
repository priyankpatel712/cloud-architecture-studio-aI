/**
 * `server-only` is a build-time guard: it throws if a module that imports it is
 * pulled into a client bundle. CLI scripts run the server modules directly, in
 * Node, with no bundler — so the guard has nothing to protect and this no-op
 * stands in for it.
 *
 * Mirrors `tests/stubs/server-only.ts`, which does the same for vitest. Both
 * exist because the alternative — dropping the `server-only` import from the
 * modules themselves — would remove a real protection from the app to satisfy
 * a tool that is not the app.
 */
export {};
