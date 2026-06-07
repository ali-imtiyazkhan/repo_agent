import * as fs from "fs/promises"
import * as path from "path"
import type { ExpectedOutcome, OutcomeResult } from "./types.js"

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

            case "tests_pass": {
                const { execaCommand } = await import("execa")
                const result = await execaCommand("npm test", {
                    cwd,
                    shell: true,
                    reject: false,
                })
                const passed = result.exitCode === 0
                return {
                    outcome,
                    passed,
                    reason: passed
                        ? "Tests passed"
                        : `Tests failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`,
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

export async function scoreAllOutcomes(
    outcomes: ExpectedOutcome[],
    cwd: string
): Promise<OutcomeResult[]> {
    return Promise.all(outcomes.map((o) => scoreOutcome(o, cwd)))
}

export function computeScore(outcomeResults: OutcomeResult[]): number {
    if (outcomeResults.length === 0) return 0
    const passedCount = outcomeResults.filter((r) => r.passed).length
    return passedCount / outcomeResults.length
}
