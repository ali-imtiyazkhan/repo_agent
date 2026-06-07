import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as crypto from "crypto"
import { createRegistry } from "@repo-agent/tools"
import { Orchestrator } from "@repo-agent/agent"
import { FIXTURES } from "./fixtures.js"
import { computeScore, scoreAllOutcomes } from "./scorer.js"
import type { EvalFixture, EvalHarnessOptions, EvalResult } from "./types.js"

export class EvalHarness {
    private outputDir: string
    private apiKey: string | undefined
    private keepWorkdir: boolean

    constructor(options: EvalHarnessOptions = {}) {
        this.outputDir = options.outputDir ?? "eval-results"
        this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY
        this.keepWorkdir = options.keepWorkdir ?? false
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
            const orchestrator = new Orchestrator(registry, this.apiKey)

            const result = await Promise.race([
                orchestrator.run(fixture.goal, cwd),
                this.timeout(fixture.timeoutMs ?? 300_000),
            ])

            if (!result || !("ok" in result)) {
                return this.failResult(fixture, "Timeout exceeded", Date.now() - start)
            }

            if (!result.ok) {
                return this.failResult(fixture, result.error.message, Date.now() - start)
            }

            const outcomeResults = await scoreAllOutcomes(fixture.expectedOutcomes, cwd)
            const score = computeScore(outcomeResults)
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
            }

            await this.saveResult(evalResult)
            this.printResult(evalResult)
            return evalResult
        } catch (e) {
            return this.failResult(fixture, (e as Error).message, Date.now() - start)
        } finally {
            if (!this.keepWorkdir) {
                await this.cleanupFixture(cwd)
            }
        }
    }

    async runAll(fixtureIds?: string[]): Promise<EvalResult[]> {
        const toRun = fixtureIds
            ? FIXTURES.filter((f) => fixtureIds.includes(f.id))
            : FIXTURES

        console.log(`\n[eval] Running ${toRun.length} fixtures\n`)

        const results: EvalResult[] = []
        for (const fixture of toRun) {
            results.push(await this.runFixture(fixture))
        }

        await this.printSummary(results)
        return results
    }

    async setupFixture(fixture: EvalFixture): Promise<string> {
        if (fixture.repoPath) {
            return fixture.repoPath
        }

        const cwd = path.join(os.tmpdir(), `eval-${fixture.id}-${crypto.randomUUID().slice(0, 8)}`)
        await fs.mkdir(cwd, { recursive: true })

        if (fixture.seedFiles) {
            for (const [filePath, content] of Object.entries(fixture.seedFiles)) {
                const fullPath = path.join(cwd, filePath)
                await fs.mkdir(path.dirname(fullPath), { recursive: true })
                await fs.writeFile(fullPath, content, "utf-8")
            }
        }

        const { execaCommand } = await import("execa")

        const hasPackageJson = fixture.seedFiles && "package.json" in fixture.seedFiles
        if (hasPackageJson) {
            await execaCommand("npm install --prefer-offline --no-audit --no-fund", {
                cwd,
                shell: true,
                reject: false,
                timeout: 120_000,
            })
        }

        await execaCommand("git init && git add . && git commit -m \"initial\"", {
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

    private timeout(ms: number): Promise<null> {
        return new Promise((resolve) => setTimeout(() => resolve(null), ms))
    }

    private failResult(fixture: EvalFixture, error: string, durationMs: number): EvalResult {
        const result: EvalResult = {
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
        this.printResult(result)
        return result
    }

    private async saveResult(result: EvalResult): Promise<void> {
        await fs.mkdir(this.outputDir, { recursive: true })
        const file = path.join(this.outputDir, `${result.fixtureId}-${Date.now()}.json`)
        await fs.writeFile(file, JSON.stringify(result, null, 2), "utf-8")
    }

    private printResult(result: EvalResult): void {
        const icon = result.passed ? "✓" : "✗"
        console.log(`\n[eval] ${icon} ${result.fixtureName}`)
        console.log(`[eval] Score: ${(result.score * 100).toFixed(0)}%`)
        console.log(`[eval] Duration: ${(result.durationMs / 1000).toFixed(1)}s`)
        if (result.error) {
            console.log(`[eval] Error: ${result.error}`)
        }

        for (const o of result.outcomeResults) {
            const outcomeIcon = o.passed ? "  ✓" : "  ✗"
            console.log(`${outcomeIcon} ${o.outcome.type}${o.outcome.target ? ` (${o.outcome.target})` : ""}: ${o.reason}`)
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

/** @deprecated Use EvalHarness instead */
export class EvalRunner extends EvalHarness {}
