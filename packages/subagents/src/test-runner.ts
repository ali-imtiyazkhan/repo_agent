import { BaseSubagent } from "./base.js"

export interface TestRunnerInput {
    cwd: string
    pattern?: string
    coverage?: boolean
}

export interface TestFailure {
    name: string
    message: string
    file: string
}

export interface TestRunnerResult {
    passed: boolean
    total: number
    passedCount: number
    failedCount: number
    failures: TestFailure[]
    summary: string
}

export class TestRunnerSubagent extends BaseSubagent<TestRunnerInput, TestRunnerResult> {
    get systemPrompt(): string {
        return `You are a test runner subagent. Your goal is to run tests, inspect their failures, and analyze the codebase using your tools if needed to understand why a test failed.
Use the testing and shell tools available to you to run tests and collect results.

You MUST respond with ONLY a valid JSON object matching the following structure when you finish:
{
  "passed": boolean,
  "total": number,
  "passedCount": number,
  "failedCount": number,
  "failures": [
    {
      "name": "string (test name)",
      "message": "string (error message)",
      "file": "string (relative file path)"
    }
  ],
  "summary": "string"
}`
    }

    get allowedTools(): string[] {
        return [
            "shell.runTests",
            "shell.exec",
            "shell.scriptRunner",
            "code.readFile",
            "code.searchInFiles",
        ]
    }

    parseOutput(text: string): TestRunnerResult {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
            throw new Error("No JSON object found in subagent response")
        }
        const parsed = JSON.parse(jsonMatch[0])
        if (
            typeof parsed.passed !== "boolean" ||
            typeof parsed.total !== "number" ||
            typeof parsed.passedCount !== "number" ||
            typeof parsed.failedCount !== "number" ||
            !Array.isArray(parsed.failures) ||
            typeof parsed.summary !== "string"
        ) {
            throw new Error("Invalid test runner output structure")
        }
        return parsed as TestRunnerResult
    }
}
