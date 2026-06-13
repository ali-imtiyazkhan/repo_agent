import OpenAI from "openai"
import type {
    ChatCompletionMessageParam,
    ChatCompletion,
} from "openai/resources/index"
import type { SubagentInput, SubagentOutput, Result, AgentError } from "@repo-agent/shared"
import { ok, err, withRetry, geminiRateLimiter } from "@repo-agent/shared"
import type { ToolRegistry } from "@repo-agent/tools"

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash"
const BASE_URL = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/"

// BaseSubagent 
// Each subagent runs in a completely isolated API context. 
// It has its own message history, its own scoped tool set, and returns
// a strongly-typed structured result back to the orchestrator.
// This is NOT a function call — it is a full independent agent execution.

export abstract class BaseSubagent<TInput, TOutput> {
    protected openai: OpenAI
    protected registry: ToolRegistry

    constructor(registry: ToolRegistry, apiKey?: string) {
        this.openai = new OpenAI({
            baseURL: BASE_URL,
            apiKey: apiKey ?? process.env.GEMINI_API_KEY,
        })
        this.registry = registry
    }

    abstract get systemPrompt(): string
    abstract get allowedTools(): string[]
    abstract parseOutput(text: string): TOutput

    async run(
        input: SubagentInput<TInput>
    ): Promise<Result<SubagentOutput<TOutput>, AgentError>> {
        const scopedRegistry = this.registry.scoped(this.allowedTools)
        const messages: ChatCompletionMessageParam[] = []
        let toolCallCount = 0
        let totalTokens = 0

        // System message
        messages.push({
            role: "system",
            content: this.systemPrompt,
        })

        // Initial message to the subagent
        messages.push({
            role: "user",
            content: this.buildPrompt(input),
        })

        // Isolated agentic loop
        while (true) {
            const response = await withRetry(() =>
                this.callModel({
                    messages,
                    tools: scopedRegistry.toOpenAITools(),
                })
            )

            if (!response.ok) return response

            const result = response.value
            const choice = result.choices?.[0]
            if (!choice) break

            const usage = result.usage
            totalTokens += (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0)

            const message = choice.message
            messages.push(message)

            // Check for tool calls
            const toolCalls = message.tool_calls ?? []

            // Done — extract structured result
            if (toolCalls.length === 0) {
                const text = message.content ?? ""

                try {
                    const parsed = this.parseOutput(text)
                    return ok({
                        result: parsed,
                        reasoning: text,
                        toolCallCount,
                        tokensUsed: totalTokens,
                    })
                } catch (e) {
                    return err({
                        code: "SUBAGENT_FAILED",
                        message: `Failed to parse subagent output: ${(e as Error).message}`,
                        retryable: false,
                        cause: e,
                    })
                }
            }

            // Process tool calls
            for (const toolCall of toolCalls) {
                const toolName = scopedRegistry.resolveOpenAIName(toolCall.function.name)
                const tool = scopedRegistry.get(toolName)
                toolCallCount++

                if (!tool) {
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({ error: `Tool not available in this context: ${toolName}` }),
                    })
                    continue
                }

                console.log(`    [subagent:${this.constructor.name}] → ${toolName}`)

                let args: unknown
                try {
                    args = JSON.parse(toolCall.function.arguments)
                } catch {
                    args = {}
                }

                const result = await tool.execute(args)

                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(
                        result.ok
                            ? (typeof result.value === "object" && result.value !== null ? result.value : { result: result.value })
                            : { error: result.error }
                    ),
                })
            }
        }

        return err({
            code: "SUBAGENT_FAILED",
            message: "Subagent loop ended without producing output",
            retryable: false,
        })
    }

    private buildPrompt(input: SubagentInput<TInput>): string {
        return [
            `Task: ${input.task}`,
            input.context ? `Context:\n${input.context}` : "",
            `Data:\n${JSON.stringify(input.data, null, 2)}`,
            `\nAvailable tools: ${this.allowedTools.join(", ")}`,
            `\nRespond with ONLY valid JSON when complete.`,
        ]
            .filter(Boolean)
            .join("\n\n")
    }

    private async callModel(params: {
        messages: ChatCompletionMessageParam[]
        tools: any[]
    }): Promise<Result<ChatCompletion, AgentError>> {
        try {
            const result = await geminiRateLimiter.wrap(() =>
                this.openai.chat.completions.create({
                    model: MODEL,
                    messages: params.messages,
                    ...(params.tools.length > 0
                        ? { tools: params.tools }
                        : {}),
                })
            )
            return ok(result)
        } catch (e) {
            const error = e as Error & { status?: number }
            return err({
                code: "SUBAGENT_FAILED",
                message: error.message,
                retryable: error.status === 429 || error.status === 503,
                cause: e,
            })
        }
    }
}