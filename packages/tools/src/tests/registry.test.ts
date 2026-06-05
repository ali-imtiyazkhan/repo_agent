import { describe, it, expect } from "vitest"
import { z } from "zod"
import { ToolRegistry, zodToJsonSchema } from "../registry.js"
import type { Tool } from "@repo-agent/shared"
import { ok } from "@repo-agent/shared"

describe("ToolRegistry & Zod to JSON Schema", () => {
    it("should register tools and list them", () => {
        const registry = new ToolRegistry()
        const dummyTool: Tool<{ val: string }, { success: boolean }> = {
            namespace: "test",
            name: "dummy",
            description: "A dummy test tool",
            inputSchema: z.object({ val: z.string().describe("a test string") }),
            outputSchema: z.object({ success: z.boolean() }),
            execute: async (input) => ok({ success: true }),
        }

        registry.register(dummyTool)
        expect(registry.size).toBe(1)
        expect(registry.has("test.dummy")).toBe(true)
        expect(registry.get("test.dummy")).toBe(dummyTool)

        const list = registry.list()
        expect(list).toContain("test.dummy")

        const sum = registry.summary()
        expect(sum["test"]).toBe(1)
    })

    it("should correctly convert ZodObject to JSON schema", () => {
        const schema = z.object({
            name: z.string().describe("User name"),
            age: z.number(),
            isAdmin: z.boolean(),
            roles: z.array(z.string()),
            status: z.enum(["active", "inactive"]),
            metadata: z.record(z.string()).optional(),
        })

        const jsonSchema = zodToJsonSchema(schema)

        expect(jsonSchema.type).toBe("object")
        expect(jsonSchema.properties).toBeDefined()
        const props = jsonSchema.properties as Record<string, any>

        expect(props.name.type).toBe("string")
        expect(props.name.description).toBe("User name")
        expect(props.age.type).toBe("number")
        expect(props.isAdmin.type).toBe("boolean")
        expect(props.roles.type).toBe("array")
        expect(props.roles.items.type).toBe("string")
        expect(props.status.type).toBe("string")
        expect(props.status.enum).toEqual(["active", "inactive"])
    })

    it("should build scoped registry correctly", () => {
        const registry = new ToolRegistry()
        const toolA: Tool<any, any> = {
            namespace: "test",
            name: "toolA",
            description: "A",
            inputSchema: z.object({}),
            outputSchema: z.object({}),
            execute: async () => ok({}),
        }
        const toolB: Tool<any, any> = {
            namespace: "test",
            name: "toolB",
            description: "B",
            inputSchema: z.object({}),
            outputSchema: z.object({}),
            execute: async () => ok({}),
        }

        registry.register(toolA).register(toolB)
        const scoped = registry.scoped(["test.toolA"])
        expect(scoped.size).toBe(1)
        expect(scoped.has("test.toolA")).toBe(true)
        expect(scoped.has("test.toolB")).toBe(false)
    })
})
