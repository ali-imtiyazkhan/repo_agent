export interface RateLimiterOptions {
    maxConcurrent: number;
    minDelayMs: number;
}
export declare class RateLimiter {
    private queue;
    private activeCount;
    private lastRequestTime;
    private maxConcurrent;
    private minDelayMs;
    constructor(options?: Partial<RateLimiterOptions>);
    acquire(): Promise<void>;
    release(): void;
    wrap<T>(fn: () => Promise<T>): Promise<T>;
}
export declare const anthropicRateLimiter: RateLimiter;
//# sourceMappingURL=rate-limit.d.ts.map