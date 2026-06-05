import Anthropic from "@anthropic-ai/sdk";
import type { SubagentInput, SubagentOutput, Result, AgentError } from "../../shared/src";
import type { ToolRegistry } from "../../tools/src";
export declare abstract class BaseSubagent<TInput, TOutput> {
    protected client: Anthropic;
    protected registry: ToolRegistry;
    constructor(registry: ToolRegistry, apiKey?: string);
    abstract get systemPrompt(): string;
    abstract get allowedTools(): string[];
    abstract parseOutput(text: string): TOutput;
    run(input: SubagentInput<TInput>): Promise<Result<SubagentOutput<TOutput>, AgentError>>;
    private buildPrompt;
    private callModel;
}
//# sourceMappingURL=base.d.ts.map