// Lets TypeScript import the reference .json files even if "resolveJsonModule" is off.
// The loader in index.ts checks the shape at runtime.
declare module '*.json' { const value: unknown; export default value; }
