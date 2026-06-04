import * as fs from "fs/promises"
import * as path from "path"

export interface TraceRecord {
    timestamp: string
    sessionId: string
    event: "session_start" | "step_update" | "tool_call" | "token_usage" | "error"
    data: Record<string, unknown>
}

export class ObservabilityLogger {
    private logFile: string
    private initialized = false

    constructor(logDir = ".agent-logs") {
        this.logFile = path.join(logDir, "trace.jsonl")
    }

    private async init() {
        if (this.initialized) return
        try {
            await fs.mkdir(path.dirname(this.logFile), { recursive: true })
            this.initialized = true
        } catch {
            // Ignore init errors (non-fatal)
        }
    }

    private async writeRecord(record: Omit<TraceRecord, "timestamp">) {
        await this.init()
        const fullRecord: TraceRecord = {
            timestamp: new Date().toISOString(),
            ...record,
        }
        try {
            await fs.appendFile(this.logFile, JSON.stringify(fullRecord) + "\n", "utf-8")
        } catch {
            // Observability write errors should not crash the agent
        }
    }

    async logSessionStart(sessionId: string, goal: string) {
        await this.writeRecord({
            sessionId,
            event: "session_start",
            data: { goal },
        })
    }

    async logStepUpdate(sessionId: string, stepId: string, description: string, status: string, durationMs?: number, error?: string) {
        await this.writeRecord({
            sessionId,
            event: "step_update",
            data: { stepId, description, status, durationMs, error },
        })
    }

    async logToolCall(sessionId: string, toolName: string, input: unknown, output: unknown, durationMs: number, success: boolean) {
        await this.writeRecord({
            sessionId,
            event: "tool_call",
            data: {
                toolName,
                input: typeof input === "object" ? input : { raw: input },
                output: typeof output === "object" ? output : { raw: output },
                durationMs,
                success,
            },
        })
    }

    async logTokenUsage(sessionId: string, eventName: string, inputTokens: number, outputTokens: number) {
        await this.writeRecord({
            sessionId,
            event: "token_usage",
            data: { eventName, inputTokens, outputTokens, total: inputTokens + outputTokens },
        })
    }

    async logError(sessionId: string, code: string, message: string, details?: unknown) {
        await this.writeRecord({
            sessionId,
            event: "error",
            data: { code, message, details },
        })
    }
}

// Export a default global logger instance as well
export const obsLogger = new ObservabilityLogger()
