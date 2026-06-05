import type { Result, AgentError } from "./types.js";
export declare function unwrap<T>(result: Result<T, AgentError>): T;
export declare function andThen<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E>;
export declare function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E>;
export declare function collect<T, E>(results: Result<T, E>[]): Result<T[], E>;
//# sourceMappingURL=result.d.ts.map