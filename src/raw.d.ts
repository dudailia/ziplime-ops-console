// Seed dry-run files imported as text (next.config.ts rule, Vite's ?raw in vitest).
declare module "*.jsonl?raw" {
  const text: string;
  export default text;
}
