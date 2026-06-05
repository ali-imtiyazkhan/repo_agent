import { BaseSubagent } from "./base.js";
export interface ReviewInput {
    diff: string;
    focusAreas?: string[];
}
export interface ReviewComment {
    file: string;
    line: number;
    comment: string;
    severity: "info" | "warning" | "error";
}
export interface ReviewResult {
    approved: boolean;
    comments: ReviewComment[];
    summary: string;
}
export declare class ReviewerSubagent extends BaseSubagent<ReviewInput, ReviewResult> {
    get systemPrompt(): string;
    get allowedTools(): string[];
    parseOutput(text: string): ReviewResult;
}
//# sourceMappingURL=reviewer.d.ts.map