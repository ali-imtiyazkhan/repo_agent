export interface EvalFixture {
    id: string
    name: string
    description: string
    goal: string
    repoUrl?: string
    repoPath?: string
    seedFiles?: Record<string, string>
    expectedOutcomes: ExpectedOutcome[]
    tags: string[]
    difficulty: "easy" | "medium" | "hard"
    maxToolCalls?: number
    timeoutMs?: number
}

export interface ExpectedOutcome {
    type:
    | "file_exists"
    | "file_contains"
    | "file_not_contains"
    | "tests_pass"
    | "no_typescript_errors"
    | "git_committed"
    | "custom"
    target?: string
    value?: string
    validator?: (cwd: string) => Promise<boolean>
}

export interface EvalResult {
    fixtureId: string
    fixtureName: string
    passed: boolean
    score: number
    outcomeResults: OutcomeResult[]
    toolCallCount: number
    tokensUsed: number
    durationMs: number
    error?: string | undefined
    sessionId?: string
}

export interface OutcomeResult {
    outcome: ExpectedOutcome
    passed: boolean
    reason: string
}

export interface EvalHarnessOptions {
    outputDir?: string
    apiKey?: string
    keepWorkdir?: boolean
}
