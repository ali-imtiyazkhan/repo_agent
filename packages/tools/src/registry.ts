import { z } from "zod"
import type { Tool } from "@repo-agent/shared"
import type { AgentError } from "@repo-agent/shared"

//  Registry 
export class ToolRegistry {
    private tools = new Map<string, Tool<unknown, unknown>>()

    register<TInput, TOutput>(tool: Tool<TInput, TOutput>): this {
        const fullName = `${tool.namespace}.${tool.name}`
        if (this.tools.has(fullName)) {
            throw new Error(`Tool already registered: ${fullName}`)
        }
        this.tools.set(fullName, tool as Tool<unknown, unknown>)
        return this
    }

    registerAll(tools: Tool<unknown, unknown>[]): this {
        for (const tool of tools) this.register(tool)
        return this
    }

    get(fullName: string): Tool<unknown, unknown> | undefined {
        return this.tools.get(fullName)
    }

    has(fullName: string): boolean {
        return this.tools.has(fullName)
    }

    // Anthropic expects dots replaced with double underscores in tool names
    toAnthropicTools(): AnthropicToolDefinition[] {
        return Array.from(this.tools.values()).map((tool) => ({
            name: `${tool.namespace}__${tool.name}`,
            description: tool.description,
            input_schema: zodToJsonSchema(tool.inputSchema),
        }))
    }

    // Resolve from Anthropic's double-underscore format back to dot format
    resolveAnthropicName(anthropicName: string): string {
        return anthropicName.replace("__", ".")
    }

    // Gemini uses functionDeclarations with underscores (dots not allowed)
    toGeminiTools(): GeminiFunctionDeclaration[] {
        return Array.from(this.tools.values()).map((tool) => ({
            name: `${tool.namespace}__${tool.name}`,
            description: tool.description,
            parameters: sanitizeGeminiSchema(zodToJsonSchema(tool.inputSchema)),
        }))
    }

    // Resolve from Gemini's double-underscore format back to dot format
    resolveGeminiName(geminiName: string): string {
        return geminiName.replace("__", ".")
    }

    // OpenAI-compatible format (used by Ollama)
    toOpenAITools(): OpenAIToolDefinition[] {
        return Array.from(this.tools.values()).map((tool) => ({
            type: "function" as const,
            function: {
                name: `${tool.namespace}__${tool.name}`,
                description: tool.description,
                parameters: zodToJsonSchema(tool.inputSchema),
            },
        }))
    }

    // Resolve from OpenAI's double-underscore format back to dot format
    resolveOpenAIName(openaiName: string): string {
        return openaiName.replace("__", ".")
    }


    namespace(ns: string): Tool<unknown, unknown>[] {
        return Array.from(this.tools.entries())
            .filter(([key]) => key.startsWith(`${ns}.`))
            .map(([, tool]) => tool)
    }

    // Scoped registry for subagents — only exposes allowed tools
    scoped(allowedNames: string[]): ToolRegistry {
        const sub = new ToolRegistry()
        for (const name of allowedNames) {
            const tool = this.tools.get(name)
            if (tool) sub.register(tool)
        }
        return sub
    }

    get size(): number {
        return this.tools.size
    }

    list(): string[] {
        return Array.from(this.tools.keys())
    }

    summary(): Record<string, number> {
        const counts: Record<string, number> = {}
        for (const key of this.tools.keys()) {
            const ns = key.split(".")[0] ?? "unknown"
            counts[ns] = (counts[ns] ?? 0) + 1
        }
        return counts
    }
}

//  Anthropic tool definition shape 

export interface AnthropicToolDefinition {
    name: string
    description: string
    input_schema: Record<string, unknown>
}

//  Gemini function declaration shape 

export interface GeminiFunctionDeclaration {
    name: string
    description: string
    parameters: Record<string, unknown>
}

//  OpenAI tool definition shape (used by Ollama)

export interface OpenAIToolDefinition {
    type: "function"
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

// Recursively remove fields not supported by Gemini API schema (like additionalProperties)
export function sanitizeGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const clone = JSON.parse(JSON.stringify(schema))

    function removeUnsupported(obj: any) {
        if (typeof obj !== "object" || obj === null) return

        if ("additionalProperties" in obj) {
            delete obj.additionalProperties
        }

        for (const value of Object.values(obj)) {
            removeUnsupported(value)
        }
    }

    removeUnsupported(clone)
    return clone
}

// Zod → JSON Schema 

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
    const def = (schema as any)._def

    switch (def.typeName) {
        case "ZodObject": {
            const shape = def.shape()
            const properties: Record<string, unknown> = {}
            const required: string[] = []

            for (const [key, value] of Object.entries(shape)) {
                const fieldDef = (value as any)._def
                properties[key] = zodToJsonSchema(value as z.ZodType)
                if (
                    fieldDef.typeName !== "ZodOptional" &&
                    fieldDef.typeName !== "ZodDefault"
                ) {
                    required.push(key)
                }
            }

            const description = def.description as string | undefined
            return {
                type: "object",
                properties,
                ...(required.length ? { required } : {}),
                ...(description ? { description } : {}),
            }
        }

        case "ZodString": {
            const description = def.description as string | undefined
            return {
                type: "string",
                ...(description ? { description } : {}),
            }
        }

        case "ZodNumber":
            return { type: "number" }

        case "ZodBoolean":
            return { type: "boolean" }

        case "ZodArray":
            return {
                type: "array",
                items: zodToJsonSchema(def.type as z.ZodType),
            }

        case "ZodOptional":
            return zodToJsonSchema(def.innerType as z.ZodType)

        case "ZodDefault":
            return zodToJsonSchema(def.innerType as z.ZodType)

        case "ZodEnum":
            return { type: "string", enum: def.values as string[] }

        case "ZodUnion":
            return {
                oneOf: (def.options as z.ZodType[]).map(zodToJsonSchema),
            }

        case "ZodNullable": {
            const inner = zodToJsonSchema(def.innerType as z.ZodType)
            return { ...inner, nullable: true }
        }

        case "ZodRecord":
            return {
                type: "object",
                additionalProperties: zodToJsonSchema(def.valueType as z.ZodType),
            }

        default:
            return { type: "string" }
    }
}