import { z } from "zod";
export interface Tool<TInput, TOutput> {
    name: string;
    namespace: string;
    description: string;
    inputSchema: z.ZodType<TInput>;
    outputSchema: z.ZodType<TOutput>;
    execute: (input: TInput) => Promise<Result<TOutput>>;
}
export type Result<T, E = AgentError> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: E;
};
export declare const ok: <T>(value: T) => Result<T, never>;
export declare const err: <E>(error: E) => Result<never, E>;
export type AgentErrorCode = "TOOL_EXECUTION_FAILED" | "TOOL_NOT_FOUND" | "RATE_LIMIT_EXCEEDED" | "MAX_RETRIES_EXCEEDED" | "CONTEXT_OVERFLOW" | "SUBAGENT_FAILED" | "VERIFICATION_FAILED" | "PLAN_COHERENCE_LOST" | "GITHUB_API_ERROR" | "GIT_ERROR" | "SHELL_ERROR" | "FILE_NOT_FOUND" | "PARSE_ERROR";
export interface AgentError {
    code: AgentErrorCode;
    message: string;
    toolName?: string;
    retryable: boolean;
    cause?: unknown;
}
export type PlanStepStatus = "pending" | "executing" | "verifying" | "done" | "failed" | "retrying";
export interface PlanStep {
    id: string;
    description: string;
    toolHints: string[];
    status: PlanStepStatus;
    attempts: number;
    maxAttempts: number;
    result?: unknown;
    verifierFeedback?: string;
    createdAt: number;
    completedAt?: number;
}
export interface Plan {
    id: string;
    goal: string;
    steps: PlanStep[];
    currentStepIndex: number;
    createdAt: number;
    tokenBudget: number;
    tokensUsed: number;
}
export interface ExecutorResult {
    stepId: string;
    toolsCalled: ToolCallRecord[];
    output: unknown;
    tokensUsed: number;
    durationMs: number;
}
export interface ToolCallRecord {
    toolName: string;
    input: unknown;
    output: unknown;
    durationMs: number;
    attempt: number;
}
export declare const VerifierVerdictSchema: z.ZodObject<{
    verdict: z.ZodEnum<["approve", "reject", "needs_clarification"]>;
    reasoning: z.ZodString;
    issues: z.ZodArray<z.ZodString, "many">;
    suggestion: z.ZodOptional<z.ZodString>;
    confidence: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    issues: string[];
    verdict: "approve" | "reject" | "needs_clarification";
    reasoning: string;
    confidence: number;
    suggestion?: string | undefined;
}, {
    issues: string[];
    verdict: "approve" | "reject" | "needs_clarification";
    reasoning: string;
    confidence: number;
    suggestion?: string | undefined;
}>;
export type VerifierResult = z.infer<typeof VerifierVerdictSchema>;
export interface SubagentInput<T> {
    task: string;
    context: string;
    data: T;
    scopedTools: string[];
}
export interface SubagentOutput<T> {
    result: T;
    reasoning: string;
    toolCallCount: number;
    tokensUsed: number;
}
export interface ContextSnapshot {
    sessionId: string;
    plan: Plan;
    toolCallLedger: ToolCallRecord[];
    summary: string;
    checkpointedAt: number;
}
//# sourceMappingURL=types.d.ts.map