import type { Result, AgentError } from "./types.js";
export interface RetryOptions {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitter: boolean;
}
export declare const DEFAULT_RETRY_OPTIONS: RetryOptions;
export declare function withRetry<T>(fn: () => Promise<Result<T, AgentError>>, opts?: Partial<RetryOptions>): Promise<Result<T, AgentError>>;
//# sourceMappingURL=retry.d.ts.map