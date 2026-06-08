import OpenAI from "openai"
import type {
    ChatCompletionMessageParam,
    ChatCompletion,
} from "openai/resources/index"
import type { Plan, Result, AgentError } from "@repo-agent/shared"
import { ok, err, withRetry } from "@repo-agent/shared"
import type { ToolRegistry } from "@repo-agent/tools"
import * as crypto from "crypto"

export class Planner {
    private openai: OpenAI
    private registry: ToolRegistry

    constructor(openai: OpenAI, registry: ToolRegistry) {
        this.openai = openai
        this.registry = registry
    }

    async plan(
        goal: string,
        cwd: string,
        modelName: string,
        tokenBudget: number,
        maxStepRetries: number,
        callModel: (params: { system: string; contents: Array<{ role: string; parts: Array<{ text?: string }> }>; tools: any[] }) => Promise<Result<ChatCompletion, AgentError>>
    ): Promise<Result<Plan, AgentError>> {
        const toolList = this.registry.list().join(", ")

        const response = await withRetry(() =>
            callModel({
                system: `You are a planning agent for a repository automation system.
Given a goal, break it into clear, ordered steps.
Available tools: ${toolList}
Return ONLY valid JSON matching this schema:
{
  "steps": [
    {
      "description": "string — what this step does",
      "toolHints": ["tool.name", ...] — tools likely needed
    }
  ]
}`,
                contents: [
                    {
                        role: "user",
                        parts: [{ text: `Goal: ${goal}\nRepository path: ${cwd}\n\nCreate a step-by-step plan.` }],
                    },
                ],
                tools: [],
            })
        )

        if (!response.ok) return response

        try {
            const choice = response.value.choices?.[0]
            const text = choice?.message?.content ?? ""

            const jsonMatch = text.match(/\{[\s\S]*\}/)
            if (!jsonMatch) throw new Error("No JSON in planner response")

            const parsed = JSON.parse(jsonMatch[0]) as {
                steps: Array<{ description: string; toolHints: string[] }>
            }

            const plan: Plan = {
                id: crypto.randomUUID(),
                goal,
                steps: parsed.steps.map((s, i) => ({
                    id: `step-${i + 1}`,
                    description: s.description,
                    toolHints: s.toolHints,
                    status: "pending",
                    attempts: 0,
                    maxAttempts: maxStepRetries,
                    createdAt: Date.now(),
                })),
                currentStepIndex: 0,
                createdAt: Date.now(),
                tokenBudget,
                tokensUsed: 0,
            }

            return ok(plan)
        } catch (e) {
            return err({
                code: "PARSE_ERROR",
                message: `Failed to parse plan: ${(e as Error).message}`,
                retryable: false,
                cause: e,
            })
        }
    }
}
