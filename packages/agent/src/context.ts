import type { ChatCompletionMessageParam, ChatCompletion } from "openai/resources/index"
import type { Plan, PlanStep, ToolCallRecord, Result, AgentError } from "@repo-agent/shared"

export function buildExecutorContext(
    step: PlanStep,
    plan: Plan,
    ledger: ToolCallRecord[],
    summary: string
): string {
    const completedSteps = plan.steps
        .filter((s) => s.status === "done")
        .map((s) => `✓ ${s.description}`)
        .join("\n")

    const recentCalls = ledger
        .slice(-10) // last 10 tool calls
        .map((r) => `  ${r.toolName}: ${JSON.stringify(r.output).slice(0, 200)}`)
        .join("\n")

    return [
        summary ? `## Context summary\n${summary}` : "",
        completedSteps ? `## Completed steps\n${completedSteps}` : "",
        recentCalls ? `## Recent tool calls\n${recentCalls}` : "",
        step.verifierFeedback
            ? `## Previous attempt feedback\n${step.verifierFeedback}`
            : "",
        `## Current step\n${step.description}`,
        `## Tool hints\n${step.toolHints.join(", ")}`,
    ]
        .filter(Boolean)
        .join("\n\n")
}

export async function summariseContext(
    plan: Plan,
    ledger: ToolCallRecord[],
    callModel: (params: { system: string; messages: ChatCompletionMessageParam[]; tools: any[] }) => Promise<Result<ChatCompletion, AgentError>>
): Promise<{ summary: string; ledger: ToolCallRecord[] }> {
    console.log("[orchestrator] Summarising context (token budget threshold reached)")

    const response = await callModel({
        system: "Summarise the following agent session context concisely for future reference.",
        messages: [
            {
                role: "user",
                content: `Goal: ${plan.goal}\n\nCompleted steps:\n${plan.steps
                    .filter((s) => s.status === "done")
                    .map((s) => `- ${s.description}: ${JSON.stringify(s.result).slice(0, 300)}`)
                    .join("\n")}\n\nRecent tool calls:\n${ledger
                    .slice(-20)
                    .map((r) => `${r.toolName}: ${JSON.stringify(r.output).slice(0, 200)}`)
                    .join("\n")}`,
            },
        ],
        tools: [],
    })

    let summary = ""
    let newLedger = ledger
    if (response.ok) {
        const choice = response.value.choices?.[0]
        summary = choice?.message?.content ?? ""
        newLedger = ledger.slice(-5)
    }

    return { summary, ledger: newLedger }
}
