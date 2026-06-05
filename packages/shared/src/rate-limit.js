export class RateLimiter {
    queue = [];
    activeCount = 0;
    lastRequestTime = 0;
    maxConcurrent;
    minDelayMs;
    constructor(options = {}) {
        this.maxConcurrent = options.maxConcurrent ?? 2;
        this.minDelayMs = options.minDelayMs ?? 500;
    }
    async acquire() {
        while (this.activeCount >= this.maxConcurrent) {
            await new Promise((resolve) => this.queue.push(resolve));
        }
        const now = Date.now();
        const timeSinceLast = now - this.lastRequestTime;
        if (timeSinceLast < this.minDelayMs) {
            const wait = this.minDelayMs - timeSinceLast;
            await new Promise((resolve) => setTimeout(resolve, wait));
        }
        this.activeCount++;
        this.lastRequestTime = Date.now();
    }
    release() {
        this.activeCount--;
        const next = this.queue.shift();
        if (next) {
            next();
        }
    }
    async wrap(fn) {
        await this.acquire();
        try {
            return await fn();
        }
        finally {
            this.release();
        }
    }
}
export const anthropicRateLimiter = new RateLimiter({ maxConcurrent: 2, minDelayMs: 1000 });
//# sourceMappingURL=rate-limit.js.map