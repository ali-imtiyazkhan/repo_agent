import { describe, it, expect, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import { EvalHarness } from "../harness.js"
import type { EvalFixture } from "../types.js"

describe("EvalHarness", () => {
    const workdirs: string[] = []

    afterEach(async () => {
        for (const dir of workdirs) {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
        }
        workdirs.length = 0
    })

    it("sets up a fixture with seed files and git repo", async () => {
        const harness = new EvalHarness({ keepWorkdir: true })
        const fixture: EvalFixture = {
            id: "test-setup",
            name: "Test setup",
            description: "test",
            goal: "test",
            difficulty: "easy",
            tags: [],
            seedFiles: {
                "src/hello.ts": "export const hello = 'world'",
            },
            expectedOutcomes: [],
        }

        const cwd = await harness.setupFixture(fixture)
        workdirs.push(cwd)

        const content = await fs.readFile(path.join(cwd, "src/hello.ts"), "utf-8")
        expect(content).toContain("hello")

        const gitDir = await fs.stat(path.join(cwd, ".git"))
        expect(gitDir.isDirectory()).toBe(true)
    })
})
