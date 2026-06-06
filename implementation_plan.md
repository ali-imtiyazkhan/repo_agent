# Switch from Anthropic to Google Gemini (Free + Fast)

**Goal:** Replace the paid Anthropic Claude API with Google Gemini 2.0 Flash, which has a **free tier** (15 RPM, 1M TPM) and is very fast.

## User Review Required

> [!IMPORTANT]
> You'll need a **Google Gemini API key** (free) from [aistudio.google.com](https://aistudio.google.com/apikey). This replaces the Anthropic key entirely.

## Proposed Changes

### Concept Mapping: Anthropic → Gemini

| Anthropic | Gemini |
|---|---|
| `@anthropic-ai/sdk` | `@google/generative-ai` |
| `claude-opus-4-5` | `gemini-2.0-flash` |
| `ANTHROPIC_API_KEY` | `GEMINI_API_KEY` |
| `Anthropic.MessageParam` | `Content` (role: `user` / `model`) |
| `Anthropic.TextBlock` | `Part` with `.text` |
| `Anthropic.ToolUseBlock` | `Part` with `.functionCall` |
| `Anthropic.ToolResultBlockParam` | `Part` with `.functionResponse` |
| `msg.stop_reason === "end_turn"` | No `functionCall` parts in response |
| `msg.usage.input_tokens` | `response.usageMetadata.promptTokenCount` |
| `tool.input_schema` | `tool.parameters` (same JSON Schema) |

---

### Agent Package

#### [MODIFY] [package.json](file:///d:/repo-agent/packages/agent/package.json)
- Remove `@anthropic-ai/sdk` dependency
- Add `@google/generative-ai` dependency

---

#### [MODIFY] [orchestrator.ts](file:///d:/repo-agent/packages/agent/src/orchestrator.ts)
The heaviest change. Replace all Anthropic SDK usage with Gemini:

- **Constructor**: Create `GoogleGenerativeAI` client instead of `Anthropic`
- **`callModel()`**: Use `model.generateContent()` instead of `client.messages.create()`
- **`execute()` agentic loop**:
  - Build `Content[]` messages with `user`/`model` roles
  - Detect tool calls via `functionCall` parts instead of `tool_use` blocks
  - Send tool results as `functionResponse` parts instead of `tool_result` blocks
  - Check for loop end: no `functionCall` in response (instead of `stop_reason === "end_turn"`)
- **`verify()`**: Same message format changes
- **Token tracking**: Use `response.usageMetadata.promptTokenCount` + `candidatesTokenCount`

---

#### [MODIFY] [planner.ts](file:///d:/repo-agent/packages/agent/src/planner.ts)
- Remove `Anthropic` import
- Update `callModel` type signature to use Gemini types
- Parse text from `response.text()` instead of filtering `TextBlock` content

---

#### [MODIFY] [context.ts](file:///d:/repo-agent/packages/agent/src/context.ts)
- Remove `Anthropic` import
- Update `callModel` type signature to use Gemini types  
- Parse text from `response.text()` instead of filtering `TextBlock` content

---

### Tools Package

#### [MODIFY] [registry.ts](file:///d:/repo-agent/packages/tools/src/registry.ts)
- Add `toGeminiTools()` method that returns `Tool[]` in Gemini's format:
  ```ts
  { functionDeclarations: [{ name, description, parameters }] }
  ```
- Keep `toAnthropicTools()` for backwards compatibility
- Add `resolveGeminiName()` (same underscore→dot conversion)

---

### Config

#### [MODIFY] [.env](file:///d:/repo-agent/.env)
- Add `GEMINI_API_KEY=your-key-here`

---

## Verification Plan

### Automated Tests
- `pnpm run build` — must compile with no TypeScript errors
- `pnpm run typecheck` — all packages pass
- `pnpm run test` — existing unit tests pass

### Manual Verification
- `pnpm run eval` — run eval suite with a real Gemini API key and verify improved pass rate
