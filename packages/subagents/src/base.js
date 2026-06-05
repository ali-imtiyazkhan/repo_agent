import Anthropic from "@anthropic-ai/sdk";
import { ok, err, withRetry, anthropicRateLimiter } from "../../shared/src";
const MODEL = "claude-opus-4-5";
const MAX_TOKENS = 4096;
// BaseSubagent 
// Each subagent runs in a completely isolated Anthropic API context. 
// It has its own message history, its own scoped tool set, and returns
// a strongly-typed structured result back to the orchestrator.
// This is NOT a function call — it is a full independent agent execution.
export class BaseSubagent {
    client;
    registry;
    constructor(registry, apiKey) {
        this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
        this.registry = registry;
    }
    async run(input) {
        const scopedRegistry = this.registry.scoped(this.allowedTools);
        const messages = [];
        let toolCallCount = 0;
        let totalTokens = 0;
        // Initial message to the subagent
        messages.push({
            role: "user",
            content: this.buildPrompt(input),
        });
        // Isolated agentic loop
        while (true) {
            const response = await withRetry(() => this.callModel({
                system: this.systemPrompt,
                messages,
                tools: scopedRegistry.toAnthropicTools(),
            }));
            if (!response.ok)
                return response;
            const msg = response.value;
            totalTokens += (msg.usage?.input_tokens ?? 0) + (msg.usage?.output_tokens ?? 0);
            messages.push({ role: "assistant", content: msg.content });
            // Done — extract structured result
            if (msg.stop_reason === "end_turn") {
                const text = msg.content
                    .filter((b) => b.type === "text")
                    .map((b) => b.text)
                    .join("");
                try {
                    const parsed = this.parseOutput(text);
                    return ok({
                        result: parsed,
                        reasoning: text,
                        toolCallCount,
                        tokensUsed: totalTokens,
                    });
                }
                catch (e) {
                    return err({
                        code: "SUBAGENT_FAILED",
                        message: `Failed to parse subagent output: ${e.message}`,
                        retryable: false,
                        cause: e,
                    });
                }
            }
            // Process tool calls
            const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");
            if (toolUseBlocks.length === 0)
                break;
            const toolResults = [];
            for (const toolUse of toolUseBlocks) {
                const toolName = scopedRegistry.resolveAnthropicName(toolUse.name);
                const tool = scopedRegistry.get(toolName);
                toolCallCount++;
                if (!tool) {
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: toolUse.id,
                        content: JSON.stringify({ error: `Tool not available in this context: ${toolName}` }),
                        is_error: true,
                    });
                    continue;
                }
                console.log(`    [subagent:${this.constructor.name}] → ${toolName}`);
                const result = await tool.execute(toolUse.input);
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(result.ok ? result.value : result.error),
                    is_error: !result.ok,
                });
            }
            messages.push({ role: "user", content: toolResults });
        }
        return err({
            code: "SUBAGENT_FAILED",
            message: "Subagent loop ended without producing output",
            retryable: false,
        });
    }
    buildPrompt(input) {
        return [
            `Task: ${input.task}`,
            input.context ? `Context:\n${input.context}` : "",
            `Data:\n${JSON.stringify(input.data, null, 2)}`,
            `\nAvailable tools: ${this.allowedTools.join(", ")}`,
            `\nRespond with ONLY valid JSON when complete.`,
        ]
            .filter(Boolean)
            .join("\n\n");
    }
    async callModel(params) {
        try {
            const msg = await anthropicRateLimiter.wrap(() => this.client.messages.create({
                model: MODEL,
                max_tokens: MAX_TOKENS,
                system: params.system,
                messages: params.messages,
                ...(params.tools.length > 0 ? { tools: params.tools } : {}),
            }));
            return ok(msg);
        }
        catch (e) {
            const error = e;
            return err({
                code: "SUBAGENT_FAILED",
                message: error.message,
                retryable: error.status === 429,
                cause: e,
            });
        }
    }
}
//# sourceMappingURL=base.js.map