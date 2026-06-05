import { BaseSubagent } from "./base.js"

export interface LinterInput {
    cwd: string
    files?: string[]
    fix?: boolean
}

export interface LintIssue {
    file: string
    line: number
    message: string
    rule: string
    severity: "error" | "warning"
}

export interface LinterResult {
    passed: boolean
    issues: LintIssue[]
    summary: string
}

export class LinterSubagent extends BaseSubagent<LinterInput, LinterResult> {
    get systemPrompt(): string {
        return `You are a linter subagent. Your goal is to inspect code style, quality, and type safety in the repository using the linting and typechecking tools available to you.
When given specific files, run ESLint on them (with or without auto-fixing), and run TypeScript type checking on the project.
Analyze any errors or warnings found, read the source files if necessary to understand the context, and compile them into a unified list.

You MUST respond with ONLY a valid JSON object matching the following structure when you finish:
{
  "passed": boolean,
  "issues": [
    {
      "file": "string (relative path)",
      "line": number,
      "message": "string",
      "rule": "string",
      "severity": "error" | "warning"
    }
  ],
  "summary": "string"
}`
    }

    get allowedTools(): string[] {
        return [
            "code.lint",
            "code.typecheck",
            "code.readFile",
            "code.getFileSummary",
        ]
    }

    parseOutput(text: string): LinterResult {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
            throw new Error("No JSON object found in subagent response")
        }
        const parsed = JSON.parse(jsonMatch[0])
        if (typeof parsed.passed !== "boolean" || !Array.isArray(parsed.issues) || typeof parsed.summary !== "string") {
            throw new Error("Invalid linter output structure")
        }
        return parsed as LinterResult
    }
}
