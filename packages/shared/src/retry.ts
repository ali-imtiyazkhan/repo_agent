import type { Result, AgentError } from "./types.js"
import { err } from "./types.js"

export interface RetryOptions {
    maxAttempts: number
    baseDelayMs: number
    maxDelayMs: number
    jitter: boolean
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
    maxAttempts: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30_000,
    jitter: true,
}

function computeDelay(attempt: number, opts: RetryOptions): number {
    const exponential = opts.baseDelayMs * Math.pow(2, attempt - 1)
    const capped = Math.min(exponential, opts.maxDelayMs)
    return opts.jitter ? capped * (0.5 + Math.random() * 0.5) : capped
}

function parseRetryDelayMs(message: string): number | undefined {
    const match = message.match(/retry (?:in|after) (\d+(?:\.\d+)?)s/i)
    if (!match) return undefined
    return Math.ceil(parseFloat(match[1]!) * 1000) + 1000
}

export async function withRetry<T>(
    fn: () => Promise<Result<T, AgentError>>,
    opts: Partial<RetryOptions> = {}
): Promise<Result<T, AgentError>> {
    const options = { ...DEFAULT_RETRY_OPTIONS, ...opts }
    let lastError: AgentError | undefined

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
        const result = await fn()

        if (result.ok) return result

        lastError = result.error

        if (!result.error.retryable) return result

        if (attempt < options.maxAttempts) {
            const rateLimitDelay = parseRetryDelayMs(result.error.message)
            const delay = rateLimitDelay ?? computeDelay(attempt, options)
            await new Promise(resolve => setTimeout(resolve, delay))
        }
    }

    return err({
        code: "MAX_RETRIES_EXCEEDED",
        message: `Failed after ${options.maxAttempts} attempts: ${lastError?.message}`,
        retryable: false,
        cause: lastError,
    })
}