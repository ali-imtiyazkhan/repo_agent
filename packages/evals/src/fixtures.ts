import type { EvalFixture } from "./types.js"

export const FIXTURES: EvalFixture[] = [
    {
        id: "fix-syntax-error",
        name: "Fix a syntax error",
        description: "Agent should identify and fix a syntax error in a TypeScript file",
        goal: "Fix the TypeScript error in src/utils.ts and make sure the file compiles",
        difficulty: "easy",
        tags: ["typescript", "fix"],
        seedFiles: {
            "src/utils.ts": `
export function add(a: number, b: number): number {
  return a + b
}

export function greet(name: string): string {
  return "Hello, " + name  // missing closing paren below
  console.log("done"
}
      `.trim(),
            "package.json": JSON.stringify({
                name: "test-repo",
                type: "module",
                devDependencies: { typescript: "^5.0.0" },
            }, null, 2),
            "tsconfig.json": JSON.stringify({
                compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext" },
                include: ["src"],
            }, null, 2),
        },
        expectedOutcomes: [
            { type: "no_typescript_errors", target: "src/utils.ts" },
            { type: "file_contains", target: "src/utils.ts", value: "console.log" },
        ],
        maxToolCalls: 15,
        timeoutMs: 120_000,
    },

    {
        id: "add-error-handling",
        name: "Add error handling to a function",
        description: "Agent should wrap an async function with try/catch and return Result type",
        goal: "Add proper error handling to the fetchUser function in src/api.ts. It should never throw — instead return a Result type with ok/err",
        difficulty: "medium",
        tags: ["typescript", "refactor", "error-handling"],
        seedFiles: {
            "src/api.ts": `
import fetch from "node-fetch"

export async function fetchUser(id: string) {
  const response = await fetch(\`https://api.example.com/users/\${id}\`)
  const data = await response.json()
  return data
}
      `.trim(),
            "src/types.ts": `
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
      `.trim(),
        },
        expectedOutcomes: [
            { type: "file_contains", target: "src/api.ts", value: "try" },
            { type: "file_contains", target: "src/api.ts", value: "catch" },
            { type: "file_contains", target: "src/api.ts", value: "Result" },
        ],
        maxToolCalls: 20,
        timeoutMs: 180_000,
    },

    {
        id: "write-unit-tests",
        name: "Write unit tests",
        description: "Agent should write vitest unit tests for existing utility functions",
        goal: "Write comprehensive unit tests for all functions in src/math.ts using vitest. Place tests in src/math.test.ts",
        difficulty: "medium",
        tags: ["testing", "vitest"],
        seedFiles: {
            "src/math.ts": `
export function add(a: number, b: number): number {
  return a + b
}

export function subtract(a: number, b: number): number {
  return a - b
}

export function multiply(a: number, b: number): number {
  return a * b
}

export function divide(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero")
  return a / b
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
      `.trim(),
            "package.json": JSON.stringify({
                name: "test-repo",
                type: "module",
                scripts: { test: "vitest run" },
                devDependencies: { vitest: "^2.0.0", typescript: "^5.0.0" },
            }, null, 2),
        },
        expectedOutcomes: [
            { type: "file_exists", target: "src/math.test.ts" },
            { type: "file_contains", target: "src/math.test.ts", value: "describe" },
            { type: "file_contains", target: "src/math.test.ts", value: "divide" },
            { type: "file_contains", target: "src/math.test.ts", value: "Division by zero" },
        ],
        maxToolCalls: 20,
        timeoutMs: 180_000,
    },

    {
        id: "create-readme",
        name: "Create a README",
        description: "Agent should analyse a repo and write a comprehensive README",
        goal: "Analyse the repository structure and write a comprehensive README.md with installation instructions, usage examples, and API documentation",
        difficulty: "easy",
        tags: ["docs"],
        seedFiles: {
            "src/index.ts": `
export { add, subtract, multiply, divide } from "./math.js"
export { fetchUser } from "./api.js"
      `.trim(),
            "src/math.ts": `
export function add(a: number, b: number): number { return a + b }
export function subtract(a: number, b: number): number { return a - b }
export function multiply(a: number, b: number): number { return a * b }
export function divide(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero")
  return a / b
}
      `.trim(),
            "package.json": JSON.stringify({
                name: "mathlib",
                version: "1.0.0",
                description: "A simple math utility library",
                type: "module",
            }, null, 2),
        },
        expectedOutcomes: [
            { type: "file_exists", target: "README.md" },
            { type: "file_contains", target: "README.md", value: "## Installation" },
            { type: "file_contains", target: "README.md", value: "add" },
        ],
        maxToolCalls: 15,
        timeoutMs: 120_000,
    },

    {
        id: "refactor-to-class",
        name: "Refactor functions to a class",
        description: "Agent should refactor standalone functions into a well-structured class",
        goal: "Refactor the functions in src/logger.ts into a Logger class with configurable log levels. Keep the same public API behaviour",
        difficulty: "hard",
        tags: ["refactor", "typescript"],
        seedFiles: {
            "src/logger.ts": `
type LogLevel = "debug" | "info" | "warn" | "error"
let currentLevel: LogLevel = "info"

const levels: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3
}

export function setLevel(level: LogLevel): void {
  currentLevel = level
}

export function debug(msg: string): void {
  if (levels[currentLevel] <= levels.debug) console.log(\`[DEBUG] \${msg}\`)
}

export function info(msg: string): void {
  if (levels[currentLevel] <= levels.info) console.log(\`[INFO] \${msg}\`)
}

export function warn(msg: string): void {
  if (levels[currentLevel] <= levels.warn) console.warn(\`[WARN] \${msg}\`)
}

export function error(msg: string): void {
  if (levels[currentLevel] <= levels.error) console.error(\`[ERROR] \${msg}\`)
}
      `.trim(),
            "package.json": JSON.stringify({
                name: "test-repo",
                type: "module",
                devDependencies: { typescript: "^5.0.0" },
            }, null, 2),
            "tsconfig.json": JSON.stringify({
                compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext" },
                include: ["src"],
            }, null, 2),
        },
        expectedOutcomes: [
            { type: "file_contains", target: "src/logger.ts", value: "class Logger" },
            { type: "file_contains", target: "src/logger.ts", value: "constructor" },
            { type: "no_typescript_errors", target: "src/logger.ts" },
        ],
        maxToolCalls: 25,
        timeoutMs: 240_000,
    },
]
