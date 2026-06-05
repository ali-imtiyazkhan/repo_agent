import { err } from "./types.js";
export const DEFAULT_RETRY_OPTIONS = {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 10_000,
    jitter: true,
};
function computeDelay(attempt, opts) {
    const exponential = opts.baseDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(exponential, opts.maxDelayMs);
    return opts.jitter ? capped * (0.5 + Math.random() * 0.5) : capped;
}
export async function withRetry(fn, opts = {}) {
    const options = { ...DEFAULT_RETRY_OPTIONS, ...opts };
    let lastError;
    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
        const result = await fn();
        if (result.ok)
            return result;
        lastError = result.error;
        if (!result.error.retryable)
            return result;
        if (attempt < options.maxAttempts) {
            const delay = computeDelay(attempt, options);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return err({
        code: "MAX_RETRIES_EXCEEDED",
        message: `Failed after ${options.maxAttempts} attempts: ${lastError?.message}`,
        retryable: false,
        cause: lastError,
    });
}
//# sourceMappingURL=retry.js.map