// The real `server-only` package throws on import outside a React Server
// Component graph, which would make every server module untestable. Vitest
// aliases the package to this no-op so the production guard stays in place
// while unit tests can still import the modules it protects.
export {};
