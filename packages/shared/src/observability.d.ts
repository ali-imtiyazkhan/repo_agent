export interface TraceRecord {
    timestamp: string;
    sessionId: string;
    event: "session_start" | "step_update" | "tool_call" | "token_usage" | "error";
    data: Record<string, unknown>;
}
export declare class ObservabilityLogger {
    private logFile;
    private initialized;
    constructor(logDir?: string);
    private init;
    private writeRecord;
    logSessionStart(sessionId: string, goal: string): Promise<void>;
    logStepUpdate(sessionId: string, stepId: string, description: string, status: string, durationMs?: number, error?: string): Promise<void>;
    logToolCall(sessionId: string, toolName: string, input: unknown, output: unknown, durationMs: number, success: boolean): Promise<void>;
    logTokenUsage(sessionId: string, eventName: string, inputTokens: number, outputTokens: number): Promise<void>;
    logError(sessionId: string, code: string, message: string, details?: unknown): Promise<void>;
}
export declare const obsLogger: ObservabilityLogger;
//# sourceMappingURL=observability.d.ts.map