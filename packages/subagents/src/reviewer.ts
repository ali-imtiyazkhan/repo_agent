import { BaseSubagent } from "./base.js"

export interface ReviewInput {
    diff: string
    focusAreas?: string[]
}

export interface ReviewComment {
    file: string
    line: number
    comment: string
    severity: "info" | "warning" | "error"
}

export interface ReviewResult {
    approved: boolean
    comments: ReviewComment[]
    summary: string
}

export class ReviewerSubagent extends BaseSubagent<ReviewInput, ReviewResult> {
    get systemPrompt(): string {
        return `You are a senior code reviewer subagent. Your goal is to review code changes (provided as a git diff) and analyze the files involved using your tools.
Look for bugs, security issues, performance problems, code style violations, or type errors.

You MUST respond with ONLY a valid JSON object matching the following structure when you finish:
{
  "approved": boolean,
  "comments": [
    {
      "file": "string (relative path)",
      "line": number,
      "comment": "string",
      "severity": "info" | "warning" | "error"
    }
  ],
  "summary": "string"
}`
    }

    get allowedTools(): string[] {
        return [
            "code.readFile",
            "code.searchInFiles",
            "code.getFileSummary",
            "code.findSymbol",
            "git.diff",
            "git.blame",
        ]
    }

    parseOutput(text: string): ReviewResult {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
            throw new Error("No JSON object found in subagent response")
        }
        const parsed = JSON.parse(jsonMatch[0])
        if (typeof parsed.approved !== "boolean" || !Array.isArray(parsed.comments) || typeof parsed.summary !== "string") {
            throw new Error("Invalid review output structure")
        }
        return parsed as ReviewResult
    }
}
