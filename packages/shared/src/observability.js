import * as fs from "fs/promises";
import * as path from "path";
export class ObservabilityLogger {
    logFile;
    initialized = false;
    constructor(logDir = ".agent-logs") {
        this.logFile = path.join(logDir, "trace.jsonl");
    }
    async init() {
        if (this.initialized)
            return;
        try {
            await fs.mkdir(path.dirname(this.logFile), { recursive: true });
            this.initialized = true;
        }
        catch {
            // Ignore init errors (non-fatal)
        }
    }
    async writeRecord(record) {
        await this.init();
        const fullRecord = {
            timestamp: new Date().toISOString(),
            ...record,
        };
        try {
            await fs.appendFile(this.logFile, JSON.stringify(fullRecord) + "\n", "utf-8");
        }
        catch {
            // Observability write errors should not crash the agent
        }
    }
    async logSessionStart(sessionId, goal) {
        await this.writeRecord({
            sessionId,
            event: "session_start",
            data: { goal },
        });
    }
    async logStepUpdate(sessionId, stepId, description, status, durationMs, error) {
        await this.writeRecord({
            sessionId,
            event: "step_update",
            data: { stepId, description, status, durationMs, error },
        });
    }
    async logToolCall(sessionId, toolName, input, output, durationMs, success) {
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
        });
    }
    async logTokenUsage(sessionId, eventName, inputTokens, outputTokens) {
        await this.writeRecord({
            sessionId,
            event: "token_usage",
            data: { eventName, inputTokens, outputTokens, total: inputTokens + outputTokens },
        });
    }
    async logError(sessionId, code, message, details) {
        await this.writeRecord({
            sessionId,
            event: "error",
            data: { code, message, details },
        });
    }
}
// Export a default global logger instance as well
export const obsLogger = new ObservabilityLogger();
//# sourceMappingURL=observability.js.map