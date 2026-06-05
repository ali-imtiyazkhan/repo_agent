import { z } from "zod"
import { ok, err } from "@repo-agent/shared"
import type { Tool, Result, AgentError, SubagentOutput } from "@repo-agent/shared"

import { getGlobalRegistry } from "../index.js"

export const agentRunReviewer: Tool<
    { diff: string; task?: string | undefined; context?: string | undefined },
    { approved: boolean; comments: any[]; summary: string }
> = {
    namespace: "agent",
    name: "runReviewer",
    description: "Run an isolated Code Reviewer Subagent on a git diff to analyze and approve/reject changes",
    inputSchema: z.object({
        diff: z.string().describe("Git diff string to review"),
        task: z.string().optional().describe("Focus areas or specific questions for the review"),
        context: z.string().optional().describe("Additional context about the change"),
    }),
    outputSchema: z.object({
        approved: z.boolean(),
        comments: z.array(
            z.object({
                file: z.string(),
                line: z.number(),
                comment: z.string(),
                severity: z.enum(["info", "warning", "error"]),
            })
        ),
        summary: z.string(),
    }),
    async execute({ diff, task = "Perform a code review on this diff", context = "" }) {
        try {
            const registry = getGlobalRegistry()
            // Dynamic import to break circular dependency: tools → subagents → tools.
            // @repo-agent/subagents cannot be a declared dependency of @repo-agent/tools
            // because subagents already depends on tools. pnpm workspace symlinks resolve
            // the specifier at runtime; we suppress the compile-time error here.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error — circular dep; resolved at runtime by pnpm workspace
            const mod = (await import("@repo-agent/subagents")) as {
                ReviewerSubagent: new (registry: ReturnType<typeof getGlobalRegistry>) => {
                    run(input: { task: string; context: string; data: { diff: string }; scopedTools: string[] }):
                        Promise<Result<SubagentOutput<{ approved: boolean; comments: any[]; summary: string }>, AgentError>>
                }
            }
            const subagent = new mod.ReviewerSubagent(registry)
            const result = await subagent.run({
                task,
                context,
                data: { diff },
                scopedTools: [],
            })

            if (!result.ok) {
                return err(result.error)
            }

            return ok(result.value.result)
        } catch (e) {
            return err({
                code: "SUBAGENT_FAILED",
                message: (e as Error).message,
                toolName: "agent.runReviewer",
                retryable: false,
                cause: e,
            })
        }
    },
}

export const agentTools = [agentRunReviewer]

