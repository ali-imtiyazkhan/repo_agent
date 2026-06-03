import type { Tool } from "../../shared/src"
import type { ZodType } from "zod"

// Registry 

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

    get(fullName: string): Tool<unknown, unknown> | undefined {
        return this.tools.get(fullName)
    }

    has(fullName: string): boolean {
        return this.tools.has(fullName)
    }

    toAnthropicTools(): AnthropicToolDefinition[] {
        return Array.from(this.tools.values()).map(tool => ({
            name: `${tool.namespace}__${tool.name}`,
            description: tool.description,
            input_schema: zodToJsonSchema(tool.inputSchema),
        }))
    }

    namespace(ns: string): Tool<unknown, unknown>[] {
        return Array.from(this.tools.entries())
            .filter(([key]) => key.startsWith(`${ns}.`))
            .map(([, tool]) => tool)
    }

    get size(): number {
        return this.tools.size
    }

    list(): string[] {
        return Array.from(this.tools.keys())
    }
}

// Anthropic tool definition shape 

export interface AnthropicToolDefinition {
    name: string
    description: string
    input_schema: Record<string, unknown>
}

// Zod → JSON Schema (minimal, covers what we need) 
// We write our own instead of pulling a library so we control the output shape
// and keep the bundle lean.

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
    const def = (schema as any)._def

    switch (def.typeName) {
        case "ZodObject": {
            const shape = def.shape()
            const properties: Record<string, unknown> = {}
            const required: string[] = []

            for (const [key, value] of Object.entries(shape)) {
                properties[key] = zodToJsonSchema(value as ZodType)
                const fieldDef = (value as any)._def
                if (fieldDef.typeName !== "ZodOptional") {
                    required.push(key)
                }
            }

            return { type: "object", properties, required }
        }

        case "ZodString":
            return {
                type: "string",
                ...(def.description ? { description: def.description } : {}),
            }

        case "ZodNumber":
            return { type: "number" }

        case "ZodBoolean":
            return { type: "boolean" }

        case "ZodArray":
            return { type: "array", items: zodToJsonSchema(def.type) }

        case "ZodOptional":
            return zodToJsonSchema(def.innerType)

        case "ZodEnum":
            return { type: "string", enum: def.values }

        case "ZodUnion":
            return { oneOf: def.options.map((o: ZodType) => zodToJsonSchema(o)) }

        default:
            return { type: "string" }
    }
}