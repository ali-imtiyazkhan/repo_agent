import { describe, it, expect, vi } from "vitest"
import { RateLimiter } from "@repo-agent/shared"
import { ObservabilityLogger } from "@repo-agent/shared"
import { createRegistry } from "@repo-agent/tools"
import * as fs from "fs/promises"

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>()
  return {
    ...actual,
    appendFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  }
})

describe("RateLimiter", () => {
    it("should limit concurrency and enforce min delay", async () => {
        const limiter = new RateLimiter({ maxConcurrent: 1, minDelayMs: 100 })
        const start = Date.now()

        await limiter.wrap(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
        })

        await limiter.wrap(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
        })

        const elapsed = Date.now() - start
        expect(elapsed).toBeGreaterThanOrEqual(150)
    })
})

describe("ObservabilityLogger", () => {
    it("should write structured logs to trace file", async () => {
        const logger = new ObservabilityLogger("mock-logs")
        await logger.logSessionStart("session-123", "Write unit tests")

        expect(fs.appendFile).toHaveBeenCalled()
        const [filePath, content] = (fs.appendFile as any).mock.calls[0]
        expect(filePath).toContain("trace.jsonl")
        const parsed = JSON.parse(content.trim())
        expect(parsed.sessionId).toBe("session-123")
        expect(parsed.event).toBe("session_start")
    })
})

describe("ToolRegistry", () => {
    it("should load tools and namespace them correctly", () => {
        const registry = createRegistry()
        expect(registry.size).toBeGreaterThanOrEqual(51)
        expect(registry.has("git.diff")).toBe(true)
        expect(registry.has("agent.runReviewer")).toBe(true)
    })
})
