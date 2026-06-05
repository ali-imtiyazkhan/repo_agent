import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as crypto from "crypto"
import { createRegistry } from "@repo-agent/tools"
import { Orchestrator } from "@repo-agent/agent"

// Types

export interface EvalFixture {
    id: string
    name: string
    description: string
    goal: string
    repoUrl?: string
    repoPath?: string
    seedFiles?: Record<string, string>  // filename → content
    expectedOutcomes: ExpectedOutcome[]
    tags: string[]
    difficulty: "easy" | "medium" | "hard"
    maxToolCalls?: number
    timeoutMs?: number
}

export interface ExpectedOutcome {
    type:
    | "file_exists"
    | "file_contains"
    | "file_not_contains"
    | "tests_pass"
    | "no_typescript_errors"
    | "git_committed"
    | "custom"
    target?: string        // file path or commit message
    value?: string         // expected content substring
    validator?: (cwd: string) => Promise<boolean>
}

export interface EvalResult {
    fixtureId: string
    fixtureName: string
    passed: boolean
    score: number          // 0.0 - 1.0
    outcomeResults: OutcomeResult[]
    toolCallCount: number
    tokensUsed: number
    durationMs: number
    error?: string | undefined
    sessionId?: string
}

export interface OutcomeResult {
    outcome: ExpectedOutcome
    passed: boolean
    reason: string
}

// ─── Built-in fixtures ────────────────────────────────────────────────────────

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
            {
                type: "no_typescript_errors",
                target: "src/utils.ts",
            },
            {
                type: "file_contains",
                target: "src/utils.ts",
                value: "console.log",
            },
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
            {
                type: "file_contains",
                target: "src/api.ts",
                value: "try",
            },
            {
                type: "file_contains",
                target: "src/api.ts",
                value: "catch",
            },
            {
                type: "file_contains",
                target: "src/api.ts",
                value: "Result",
            },
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
            {
                type: "file_exists",
                target: "src/math.test.ts",
            },
            {
                type: "file_contains",
                target: "src/math.test.ts",
                value: "describe",
            },
            {
                type: "file_contains",
                target: "src/math.test.ts",
                value: "divide",
            },
            {
                type: "file_contains",
                target: "src/math.test.ts",
                value: "Division by zero",
            },
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
            {
                type: "file_exists",
                target: "README.md",
            },
            {
                type: "file_contains",
                target: "README.md",
                value: "## Installation",
            },
            {
                type: "file_contains",
                target: "README.md",
                value: "add",
            },
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
        },
        expectedOutcomes: [
            {
                type: "file_contains",
                target: "src/logger.ts",
                value: "class Logger",
            },
            {
                type: "file_contains",
                target: "src/logger.ts",
                value: "constructor",
            },
            {
                type: "no_typescript_errors",
                target: "src/logger.ts",
            },
        ],
        maxToolCalls: 25,
        timeoutMs: 240_000,
    },
]

// ─── Scorer ───────────────────────────────────────────────────────────────────

export async function scoreOutcome(
    outcome: ExpectedOutcome,
    cwd: string
): Promise<OutcomeResult> {
    try {
        switch (outcome.type) {
            case "file_exists": {
                const filePath = path.join(cwd, outcome.target!)
                try {
                    await fs.access(filePath)
                    return { outcome, passed: true, reason: `File exists: ${outcome.target}` }
                } catch {
                    return { outcome, passed: false, reason: `File not found: ${outcome.target}` }
                }
            }

            case "file_contains": {
                const filePath = path.join(cwd, outcome.target!)
                try {
                    const content = await fs.readFile(filePath, "utf-8")
                    const contains = content.includes(outcome.value!)
                    return {
                        outcome,
                        passed: contains,
                        reason: contains
                            ? `File contains expected string`
                            : `File missing: "${outcome.value}"`,
                    }
                } catch {
                    return { outcome, passed: false, reason: `Could not read file: ${outcome.target}` }
                }
            }

            case "file_not_contains": {
                const filePath = path.join(cwd, outcome.target!)
                try {
                    const content = await fs.readFile(filePath, "utf-8")
                    const contains = content.includes(outcome.value!)
                    return {
                        outcome,
                        passed: !contains,
                        reason: !contains
                            ? `File correctly does not contain string`
                            : `File unexpectedly contains: "${outcome.value}"`,
                    }
                } catch {
                    return { outcome, passed: false, reason: `Could not read file: ${outcome.target}` }
                }
            }

            case "no_typescript_errors": {
                const { execaCommand } = await import("execa")
                const result = await execaCommand("npx tsc --noEmit --pretty false", {
                    cwd,
                    shell: true,
                    reject: false,
                })
                const hasErrors = result.stdout.includes(": error TS") ||
                    result.stderr.includes(": error TS")
                return {
                    outcome,
                    passed: !hasErrors,
                    reason: hasErrors
                        ? `TypeScript errors found: ${result.stdout.slice(0, 200)}`
                        : "No TypeScript errors",
                }
            }

            case "git_committed": {
                const { execaCommand } = await import("execa")
                const result = await execaCommand("git log --oneline -1", {
                    cwd,
                    shell: true,
                    reject: false,
                })
                const lastCommit = result.stdout.trim()
                const matches = outcome.value
                    ? lastCommit.includes(outcome.value)
                    : lastCommit.length > 0
                return {
                    outcome,
                    passed: matches,
                    reason: matches
                        ? `Git commit found: ${lastCommit}`
                        : `Expected commit containing "${outcome.value}", got: ${lastCommit}`,
                }
            }

            case "custom": {
                if (!outcome.validator) {
                    return { outcome, passed: false, reason: "No validator provided" }
                }
                const passed = await outcome.validator(cwd)
                return { outcome, passed, reason: passed ? "Custom validator passed" : "Custom validator failed" }
            }

            default:
                return { outcome, passed: false, reason: `Unknown outcome type: ${outcome.type}` }
        }
    } catch (e) {
        return {
            outcome,
            passed: false,
            reason: `Scorer error: ${(e as Error).message}`,
        }
    }
}

// ─── Eval Runner ──────────────────────────────────────────────────────────────

export class EvalRunner {
    private outputDir: string

    constructor(outputDir = "eval-results") {
        this.outputDir = outputDir
    }

    async runFixture(fixture: EvalFixture): Promise<EvalResult> {
        console.log(`\n${"─".repeat(60)}`)
        console.log(`[eval] Running: ${fixture.name} (${fixture.id})`)
        console.log(`[eval] Difficulty: ${fixture.difficulty}`)
        console.log(`[eval] Goal: ${fixture.goal}`)
        console.log(`${"─".repeat(60)}\n`)

        const start = Date.now()
        const cwd = await this.setupFixture(fixture)

        try {
            const registry = createRegistry()
            const orchestrator = new Orchestrator(registry)

            const result = await Promise.race([
                orchestrator.run(fixture.goal, cwd),
                this.timeout(fixture.timeoutMs ?? 300_000),
            ])

            if (!result || !("ok" in result)) {
                return this.failResult(fixture, "Timeout exceeded", Date.now() - start)
            }

            // Agent returned an error (e.g. auth failure, plan parse error)
            if (!result.ok) {
                return this.failResult(fixture, result.error.message, Date.now() - start)
            }

            // Score outcomes
            const outcomeResults = await Promise.all(
                fixture.expectedOutcomes.map((o) => scoreOutcome(o, cwd))
            )

            const passedCount = outcomeResults.filter((r) => r.passed).length
            const score = passedCount / fixture.expectedOutcomes.length
            const passed = score === 1.0

            const evalResult: EvalResult = {
                fixtureId: fixture.id,
                fixtureName: fixture.name,
                passed,
                score,
                outcomeResults,
                toolCallCount: 0,
                tokensUsed: 0,
                durationMs: Date.now() - start,
                error: undefined,
            }

            await this.saveResult(evalResult)
            this.printResult(evalResult)
            return evalResult
        } catch (e) {
            return this.failResult(fixture, (e as Error).message, Date.now() - start)
        } finally {
            await this.cleanupFixture(cwd)
        }
    }

    async runAll(fixtureIds?: string[]): Promise<EvalResult[]> {
        const toRun = fixtureIds
            ? FIXTURES.filter((f) => fixtureIds.includes(f.id))
            : FIXTURES

        console.log(`\n[eval] Running ${toRun.length} fixtures\n`)

        const results: EvalResult[] = []
        for (const fixture of toRun) {
            const result = await this.runFixture(fixture)
            results.push(result)
        }

        await this.printSummary(results)
        return results
    }

    // ─── Fixture setup ─────────────────────────────────────────────────────────

    private async setupFixture(fixture: EvalFixture): Promise<string> {
        const cwd = path.join(os.tmpdir(), `eval-${fixture.id}-${crypto.randomUUID().slice(0, 8)}`)
        await fs.mkdir(cwd, { recursive: true })

        // Write seed files
        if (fixture.seedFiles) {
            for (const [filePath, content] of Object.entries(fixture.seedFiles)) {
                const fullPath = path.join(cwd, filePath)
                await fs.mkdir(path.dirname(fullPath), { recursive: true })
                await fs.writeFile(fullPath, content, "utf-8")
            }
        }

        // Init git repo
        const { execaCommand } = await import("execa")
        await execaCommand("git init && git add . && git commit -m 'initial'", {
            cwd,
            shell: true,
            reject: false,
        })

        return cwd
    }

    private async cleanupFixture(cwd: string): Promise<void> {
        try {
            await fs.rm(cwd, { recursive: true, force: true })
        } catch {
            // non-fatal
        }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    private timeout(ms: number): Promise<null> {
        return new Promise((resolve) => setTimeout(() => resolve(null), ms))
    }

    private failResult(
        fixture: EvalFixture,
        error: string,
        durationMs: number
    ): EvalResult {
        return {
            fixtureId: fixture.id,
            fixtureName: fixture.name,
            passed: false,
            score: 0,
            outcomeResults: fixture.expectedOutcomes.map((o) => ({
                outcome: o,
                passed: false,
                reason: `Fixture failed: ${error}`,
            })),
            toolCallCount: 0,
            tokensUsed: 0,
            durationMs,
            error,
        }
    }

    private async saveResult(result: EvalResult): Promise<void> {
        await fs.mkdir(this.outputDir, { recursive: true })
        const file = path.join(
            this.outputDir,
            `${result.fixtureId}-${Date.now()}.json`
        )
        await fs.writeFile(file, JSON.stringify(result, null, 2), "utf-8")
    }

    private printResult(result: EvalResult): void {
        const icon = result.passed ? "✓" : "✗"
        console.log(`\n[eval] ${icon} ${result.fixtureName}`)
        console.log(`[eval] Score: ${(result.score * 100).toFixed(0)}%`)
        console.log(`[eval] Duration: ${(result.durationMs / 1000).toFixed(1)}s`)

        for (const o of result.outcomeResults) {
            const icon = o.passed ? "  ✓" : "  ✗"
            console.log(`${icon} ${o.outcome.type}${o.outcome.target ? ` (${o.outcome.target})` : ""}: ${o.reason}`)
        }
    }

    private async printSummary(results: EvalResult[]): Promise<void> {
        const passed = results.filter((r) => r.passed).length
        const avgScore = results.reduce((a, r) => a + r.score, 0) / results.length

        console.log(`\n${"═".repeat(60)}`)
        console.log(`EVAL SUMMARY`)
        console.log(`${"═".repeat(60)}`)
        console.log(`Passed:    ${passed}/${results.length}`)
        console.log(`Avg Score: ${(avgScore * 100).toFixed(1)}%`)
        console.log(``)

        for (const r of results) {
            const icon = r.passed ? "✓" : "✗"
            console.log(`  ${icon} ${r.fixtureName.padEnd(40)} ${(r.score * 100).toFixed(0)}%`)
        }

        // Save summary
        const summaryPath = path.join(this.outputDir, `summary-${Date.now()}.json`)
        await fs.mkdir(this.outputDir, { recursive: true })
        await fs.writeFile(
            summaryPath,
            JSON.stringify({ passed, total: results.length, avgScore, results }, null, 2),
            "utf-8"
        )
        console.log(`\n[eval] Results saved to ${this.outputDir}/`)
    }
}
