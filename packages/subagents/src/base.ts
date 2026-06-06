import {
    GoogleGenerativeAI,
    type Content,
    type Part,
    type GenerateContentResult,
} from "@google/generative-ai"
import type { SubagentInput, SubagentOutput, Result, AgentError } from "@repo-agent/shared"
import { ok, err, withRetry, geminiRateLimiter } from "@repo-agent/shared"
import type { ToolRegistry } from "@repo-agent/tools"

const MODEL = "gemini-2.0-flash"

// BaseSubagent 
// Each subagent runs in a completely isolated Gemini API context. 
// It has its own message history, its own scoped tool set, and returns
// a strongly-typed structured result back to the orchestrator.
// This is NOT a function call — it is a full independent agent execution.

export abstract class BaseSubagent<TInput, TOutput> {
    protected genAI: GoogleGenerativeAI
    protected registry: ToolRegistry

    constructor(registry: ToolRegistry, apiKey?: string) {
        const key = apiKey ?? process.env.GEMINI_API_KEY
        if (!key) throw new Error("GEMINI_API_KEY is required")
        this.genAI = new GoogleGenerativeAI(key)
        this.registry = registry
    }

    abstract get systemPrompt(): string
    abstract get allowedTools(): string[]
    abstract parseOutput(text: string): TOutput

    async run(
        input: SubagentInput<TInput>
    ): Promise<Result<SubagentOutput<TOutput>, AgentError>> {
        const scopedRegistry = this.registry.scoped(this.allowedTools)
        const contents: Content[] = []
        let toolCallCount = 0
        let totalTokens = 0

        // Initial message to the subagent
        contents.push({
            role: "user",
            parts: [{ text: this.buildPrompt(input) }],
        })

        // Isolated agentic loop
        while (true) {
            const response = await withRetry(() =>
                this.callModel({
                    system: this.systemPrompt,
                    contents,
                    tools: scopedRegistry.toGeminiTools(),
                })
            )

            if (!response.ok) return response

            const result = response.value
            const candidate = result.response.candidates?.[0]
            if (!candidate) break

            const usage = result.response.usageMetadata
            totalTokens += (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0)

            const responseParts = candidate.content?.parts ?? []
            contents.push({ role: "model", parts: responseParts })

            // Check for function calls
            const functionCalls = responseParts.filter(
                (p: Part) => "functionCall" in p && p.functionCall
            )

            // Done — extract structured result
            if (functionCalls.length === 0) {
                const text = responseParts
                    .filter((p: Part) => "text" in p && p.text)
                    .map((p: Part) => p.text)
                    .join("")

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
            const functionResponses: Part[] = []

            for (const part of functionCalls) {
                const fc = part.functionCall!
                const toolName = scopedRegistry.resolveGeminiName(fc.name)
                const tool = scopedRegistry.get(toolName)
                toolCallCount++

                if (!tool) {
                    functionResponses.push({
                        functionResponse: {
                            name: fc.name,
                            response: { error: `Tool not available in this context: ${toolName}` },
                        },
                    })
                    continue
                }

                console.log(`    [subagent:${this.constructor.name}] → ${toolName}`)
                const result = await tool.execute(fc.args)

                functionResponses.push({
                    functionResponse: {
                        name: fc.name,
                        response: result.ok
                            ? (typeof result.value === "object" && result.value !== null ? result.value : { result: result.value })
                            : { error: result.error },
                    },
                })
            }

            contents.push({ role: "user", parts: functionResponses })
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
        system: string
        contents: Content[]
        tools: any[]
    }): Promise<Result<GenerateContentResult, AgentError>> {
        try {
            const model = this.genAI.getGenerativeModel({
                model: MODEL,
                systemInstruction: params.system,
                ...(params.tools.length > 0
                    ? { tools: [{ functionDeclarations: params.tools }] }
                    : {}),
            })

            const result = await geminiRateLimiter.wrap(() =>
                model.generateContent({ contents: params.contents })
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