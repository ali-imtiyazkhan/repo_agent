import { z } from "zod"

//  Tool shape 
export interface Tool<TInput, TOutput> {
    name: string
    namespace: string
    description: string
    inputSchema: z.ZodType<TInput>
    outputSchema: z.ZodType<TOutput>
    execute: (input: TInput) => Promise<Result<TOutput>>
}

export type Result<T, E = AgentError> =
    | { ok: true; value: T }
    | { ok: false; error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })


// Error types 
export type AgentErrorCode =
    | "TOOL_EXECUTION_FAILED"
    | "TOOL_NOT_FOUND"
    | "RATE_LIMIT_EXCEEDED"
    | "MAX_RETRIES_EXCEEDED"
    | "CONTEXT_OVERFLOW"
    | "SUBAGENT_FAILED"
    | "VERIFICATION_FAILED"
    | "PLAN_COHERENCE_LOST"
    | "GITHUB_API_ERROR"
    | "GIT_ERROR"
    | "SHELL_ERROR"
    | "FILE_NOT_FOUND"
    | "PARSE_ERROR"

export interface AgentError {
    code: AgentErrorCode
    message: string
    toolName?: string
    retryable: boolean
    cause?: unknown
}

// Plan types 
export type PlanStepStatus =
    | "pending"
    | "executing"
    | "verifying"
    | "done"
    | "failed"
    | "retrying"

export interface PlanStep {
    id: string
    description: string
    toolHints: string[]
    status: PlanStepStatus
    attempts: number
    maxAttempts: number
    result?: unknown
    verifierFeedback?: string
    createdAt: number
    completedAt?: number
}

export interface Plan {
    id: string
    goal: string
    steps: PlanStep[]
    currentStepIndex: number
    createdAt: number
    tokenBudget: number
    tokensUsed: number
}

// Executor / Verifier 
export interface ExecutorResult {
    stepId: string
    toolsCalled: ToolCallRecord[]
    output: unknown
    tokensUsed: number
    durationMs: number
}

export interface ToolCallRecord {
    toolName: string
    input: unknown
    output: unknown
    durationMs: number
    attempt: number
}

// Verifier result schema
export const VerifierVerdictSchema = z.object({
    verdict: z.enum(["approve", "reject", "needs_clarification"]),
    reasoning: z.string(),
    issues: z.array(z.string()),
    suggestion: z.string().optional(),
    confidence: z.number().min(0).max(1),
})

export type VerifierResult = z.infer<typeof VerifierVerdictSchema>

// Subagent 
export interface SubagentInput<T> {
    task: string
    context: string
    data: T
    scopedTools: string[]
}

export interface SubagentOutput<T> {
    result: T
    reasoning: string
    toolCallCount: number
    tokensUsed: number
}

// Context snapshot (for checkpointing) 
export interface ContextSnapshot {
    sessionId: string
    plan: Plan
    toolCallLedger: ToolCallRecord[]
    summary: string
    checkpointedAt: number
}