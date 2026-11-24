// Vitest runs this one optional integration test in Node, while the application
// itself has no Node runtime dependency. Keep the declaration narrow.
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
