import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { scoreOutcome, computeScore } from "../scorer.js"

describe("scoreOutcome", () => {
    let cwd: string

    beforeEach(async () => {
        cwd = path.join(os.tmpdir(), `scorer-test-${Date.now()}`)
        await fs.mkdir(cwd, { recursive: true })
    })

    afterEach(async () => {
        await fs.rm(cwd, { recursive: true, force: true })
    })

    it("passes file_exists when file is present", async () => {
        await fs.writeFile(path.join(cwd, "hello.txt"), "world", "utf-8")
        const result = await scoreOutcome({ type: "file_exists", target: "hello.txt" }, cwd)
        expect(result.passed).toBe(true)
    })

    it("fails file_exists when file is missing", async () => {
        const result = await scoreOutcome({ type: "file_exists", target: "missing.txt" }, cwd)
        expect(result.passed).toBe(false)
    })

    it("passes file_contains when substring is found", async () => {
        await fs.writeFile(path.join(cwd, "code.ts"), "export const x = 1", "utf-8")
        const result = await scoreOutcome(
            { type: "file_contains", target: "code.ts", value: "export const" },
            cwd
        )
        expect(result.passed).toBe(true)
    })

    it("computes score as ratio of passed outcomes", () => {
        const score = computeScore([
            { outcome: { type: "file_exists", target: "a" }, passed: true, reason: "" },
            { outcome: { type: "file_exists", target: "b" }, passed: false, reason: "" },
        ])
        expect(score).toBe(0.5)
    })
})
