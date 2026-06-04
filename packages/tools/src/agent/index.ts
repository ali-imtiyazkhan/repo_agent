import { z } from "zod"
import { ok, err } from "../../../shared/src/index.js"
import type { Tool } from "../../../shared/src/index.js"
import { ReviewerSubagent } from "../../../subagents/index.js"
import { getGlobalRegistry } from "../index.js"

export const agentRunReviewer: Tool<
    { diff: string; task?: string; context?: string },
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
            const subagent = new ReviewerSubagent(registry)
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
