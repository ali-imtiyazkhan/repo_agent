export interface RateLimiterOptions {
    maxConcurrent: number
    minDelayMs: number
}

export class RateLimiter {
    private queue: (() => void)[] = []
    private activeCount = 0
    private lastRequestTime = 0
    private maxConcurrent: number
    private minDelayMs: number

    constructor(options: Partial<RateLimiterOptions> = {}) {
        this.maxConcurrent = options.maxConcurrent ?? 2
        this.minDelayMs = options.minDelayMs ?? 500
    }

    async acquire(): Promise<void> {
        while (this.activeCount >= this.maxConcurrent) {
            await new Promise<void>((resolve) => this.queue.push(resolve))
        }

        const now = Date.now()
        const timeSinceLast = now - this.lastRequestTime
        if (timeSinceLast < this.minDelayMs) {
            const wait = this.minDelayMs - timeSinceLast
            await new Promise((resolve) => setTimeout(resolve, wait))
        }

        this.activeCount++
        this.lastRequestTime = Date.now()
    }

    release(): void {
        this.activeCount--
        const next = this.queue.shift()
        if (next) {
            next()
        }
    }

    async wrap<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire()
        try {
            return await fn()
        } finally {
            this.release()
        }
    }
}

// Gemini rate limiter — serialise to avoid hitting API limits
export const geminiRateLimiter = new RateLimiter({ maxConcurrent: 1, minDelayMs: 100 })
