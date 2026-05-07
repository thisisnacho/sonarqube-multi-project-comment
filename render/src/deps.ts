// Tiny dependency-inversion seams for the parts of the action that talk to the
// outside world. Production wiring lives in index.ts (the composition root);
// tests pass fakes directly instead of mutating globals or `vi.mock`-ing
// modules.

export type Fetch = typeof fetch;

export type Sleep = (ms: number) => Promise<void>;

export type ReadFile = (path: string) => Promise<string>;

/** Resolve a glob pattern (newline-separated) to absolute file paths. */
export type Globber = (patterns: string) => Promise<string[]>;
