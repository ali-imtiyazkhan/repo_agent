import Anthropic from "@anthropic-ai/sdk"
import type {
  Plan,
  PlanStep,
  ExecutorResult,
  VerifierResult,
  ContextSnapshot,
  ToolCallRecord,
  Result,
  AgentError,
} from "@repo-agent/shared"
import { ok, err, withRetry, obsLogger, anthropicRateLimiter } from "@repo-agent/shared"
import type { ToolRegistry } from "@repo-agent/tools"
import { VERIFIER_TOOLS } from "@repo-agent/tools"
import * as fs from "fs/promises"
import * as path from "path"
import * as crypto from "crypto"
import { Planner } from "./planner.js"
import { saveCheckpoint, loadCheckpoint } from "./checkpoint.js"
import { buildExecutorContext, summariseContext } from "./context.js"

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL = "claude-opus-4-5"
const MAX_TOKENS = 4096
const TOKEN_BUDGET = 180_000       // summarise when context approaches this
const SUMMARY_THRESHOLD = 0.75     // summarise at 75% of budget
const MAX_STEP_RETRIES = 3
const CHECKPOINT_DIR = ".agent-checkpoints"

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class Orchestrator {
  private client: Anthropic
  private registry: ToolRegistry
  private sessionId: string
  private ledger: ToolCallRecord[] = []
  private summary: string = ""
  private tokensUsed: number = 0

  constructor(registry: ToolRegistry, apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY })
    this.registry = registry
    this.sessionId = crypto.randomUUID()
  }

  // ─── Main entry point ───────────────────────────────────────────────────────

  async run(goal: string, cwd: string): Promise<Result<string, AgentError>> {
    console.log(`\n[orchestrator] Session ${this.sessionId}`)
    console.log(`[orchestrator] Goal: ${goal}\n`)
    await obsLogger.logSessionStart(this.sessionId, goal)

    // Step 1: Plan
    const planner = new Planner(this.client, this.registry)
    const planResult = await planner.plan(
      goal,
      cwd,
      MODEL,
      TOKEN_BUDGET,
      MAX_STEP_RETRIES,
      (params) => this.callModel(params)
    )
    if (!planResult.ok) {
      await obsLogger.logError(this.sessionId, planResult.error.code, planResult.error.message)
      return planResult
    }

    const plan = planResult.value
    console.log(`[orchestrator] Plan created with ${plan.steps.length} steps\n`)

    // Step 2: Execute each step with Verify loop
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]!
      plan.currentStepIndex = i

      console.log(`\n[orchestrator] ── Step ${i + 1}/${plan.steps.length}: ${step.description}`)
      await obsLogger.logStepUpdate(this.sessionId, step.id, step.description, "executing")

      const stepResult = await this.executeWithVerify(step, plan, cwd)
      if (!stepResult.ok) {
        console.error(`[orchestrator] Step failed: ${stepResult.error.message}`)
        await obsLogger.logStepUpdate(this.sessionId, step.id, step.description, "failed", undefined, stepResult.error.message)
        if (stepResult.error.code === "PLAN_COHERENCE_LOST") {
          return stepResult
        }
        // Non-fatal: mark step failed, continue
        step.status = "failed"
        continue
      }

      step.status = "done"
      step.result = stepResult.value
      step.completedAt = Date.now()
      await obsLogger.logStepUpdate(this.sessionId, step.id, step.description, "done")

      // Context management: summarise if approaching token budget
      if (this.tokensUsed > TOKEN_BUDGET * SUMMARY_THRESHOLD) {
        const summaryRes = await summariseContext(plan, this.ledger, (params) => this.callModel(params))
        this.summary = summaryRes.summary
        this.ledger = summaryRes.ledger
        this.tokensUsed = Math.floor(this.tokensUsed * 0.3)
      }

      // Checkpoint after every step
      await saveCheckpoint(this.sessionId, plan, this.ledger, this.summary)
    }

    const completed = plan.steps.filter((s) => s.status === "done").length
    const summary = `Completed ${completed}/${plan.steps.length} steps for goal: "${goal}"`
    console.log(`\n[orchestrator] ${summary}`)
    return ok(summary)
  }

  // ─── Executor ───────────────────────────────────────────────────────────────

  private async execute(
    step: PlanStep,
    plan: Plan,
    cwd: string
  ): Promise<Result<ExecutorResult, AgentError>> {
    const start = Date.now()
    step.status = "executing"
    step.attempts++

    const toolCallsThisStep: ToolCallRecord[] = []
    const messages: Anthropic.MessageParam[] = []

    // Build context: summary of past steps + ledger of recent tool calls
    const context = buildExecutorContext(step, plan, this.ledger, this.summary)

    messages.push({
      role: "user",
      content: context,
    })

    // Agentic loop: keep calling model until it stops using tools
    let continueLoop = true
    let lastOutput: unknown = null

    while (continueLoop) {
      const response = await withRetry(() =>
        this.callModel({
          system: this.executorSystemPrompt(cwd),
          messages,
          tools: this.registry.toAnthropicTools(),
        })
      )

      if (!response.ok) return response

      const msg = response.value
      this.tokensUsed += msg.usage?.input_tokens ?? 0
      this.tokensUsed += msg.usage?.output_tokens ?? 0

      // Add assistant message to history
      messages.push({ role: "assistant", content: msg.content })

      if (msg.stop_reason === "end_turn") {
        continueLoop = false
        lastOutput = msg.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
        break
      }

      // Process tool calls
      const toolUseBlocks = msg.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      )

      if (toolUseBlocks.length === 0) {
        continueLoop = false
        break
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const toolUse of toolUseBlocks) {
        const toolName = this.registry.resolveAnthropicName(toolUse.name)
        const tool = this.registry.get(toolName)
        const callStart = Date.now()

        if (!tool) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: `Tool not found: ${toolName}` }),
            is_error: true,
          })
          continue
        }

        console.log(`  [exec] → ${toolName}`)

        const result = await tool.execute(toolUse.input)
        const duration = Date.now() - callStart
        await obsLogger.logToolCall(this.sessionId, toolName, toolUse.input, result.ok ? result.value : result.error, duration, result.ok)

        const record: ToolCallRecord = {
          toolName,
          input: toolUse.input,
          output: result.ok ? result.value : result.error,
          durationMs: duration,
          attempt: step.attempts,
        }

        toolCallsThisStep.push(record)
        this.ledger.push(record)
        lastOutput = result.ok ? result.value : null

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result.ok ? result.value : result.error),
          is_error: !result.ok,
        })
      }

      messages.push({ role: "user", content: toolResults })
    }

    return ok({
      stepId: step.id,
      toolsCalled: toolCallsThisStep,
      output: lastOutput,
      tokensUsed: this.tokensUsed,
      durationMs: Date.now() - start,
    })
  }

  // ─── Verifier ───────────────────────────────────────────────────────────────

  private async verify(
    step: PlanStep,
    executorResult: ExecutorResult,
    cwd: string
  ): Promise<Result<VerifierResult, AgentError>> {
    step.status = "verifying"

    const scopedRegistry = this.registry.scoped(VERIFIER_TOOLS)

    const verifierPrompt = `You are a senior engineer verifying whether a step was completed correctly.

Step description: ${step.description}
Tools called: ${executorResult.toolsCalled.map((t) => t.toolName).join(", ")}
Step output: ${JSON.stringify(executorResult.output, null, 2).slice(0, 2000)}
Repository path: ${cwd}

Verify that:
1. The step actually accomplished what was described
2. No regressions were introduced
3. The output is correct and complete

You may use your available tools to inspect files, run tests, or check the codebase.

Respond with ONLY this JSON:
{
  "verdict": "approve" | "reject" | "needs_clarification",
  "reasoning": "string",
  "issues": ["string"],
  "suggestion": "string (optional — what executor should do differently)",
  "confidence": 0.0-1.0
}`

    const response = await withRetry(() =>
      this.callModel({
        system: "You are a strict code reviewer. Be precise and thorough.",
        messages: [{ role: "user", content: verifierPrompt }],
        tools: scopedRegistry.toAnthropicTools(),
      })
    )

    if (!response.ok) return response

    try {
      const text = response.value.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error("No JSON in verifier response")

      const parsed = JSON.parse(jsonMatch[0]) as VerifierResult
      console.log(`  [verify] verdict=${parsed.verdict} confidence=${parsed.confidence}`)

      return ok(parsed)
    } catch (e) {
      return err({
        code: "PARSE_ERROR",
        message: `Failed to parse verifier response: ${(e as Error).message}`,
        retryable: true,
        cause: e,
      })
    }
  }

  // ─── Execute with Verify loop ────────────────────────────────────────────────

  private async executeWithVerify(
    step: PlanStep,
    plan: Plan,
    cwd: string
  ): Promise<Result<ExecutorResult, AgentError>> {
    while (step.attempts < step.maxAttempts) {
      // Execute
      const execResult = await this.execute(step, plan, cwd)
      if (!execResult.ok) return execResult

      // Verify
      const verifyResult = await this.verify(step, execResult.value, cwd)
      if (!verifyResult.ok) {
        // Verifier itself failed — trust the executor result
        console.warn(`  [verify] Verifier error: ${verifyResult.error.message}`)
        return execResult
      }

      const verdict = verifyResult.value

      if (verdict.verdict === "approve") {
        return execResult
      }

      if (verdict.verdict === "reject") {
        if (step.attempts >= step.maxAttempts) {
          return err({
            code: "VERIFICATION_FAILED",
            message: `Step "${step.description}" failed verification after ${step.attempts} attempts. Issues: ${verdict.issues.join("; ")}`,
            retryable: false,
          })
        }

        // Inject verifier feedback for next attempt
        step.verifierFeedback = `Previous attempt rejected. Issues: ${verdict.issues.join("; ")}. Suggestion: ${verdict.suggestion ?? "try again"}`
        console.log(`  [verify] Rejected — retrying with feedback`)
        continue
      }

      // needs_clarification — treat as approve with warning
      console.warn(`  [verify] Needs clarification: ${verdict.reasoning}`)
      return execResult
    }

    return err({
      code: "PLAN_COHERENCE_LOST",
      message: `Step "${step.description}" exhausted all ${step.maxAttempts} attempts`,
      retryable: false,
    })
  }

  // Resume from a checkpoint
  static async resume(
    sessionId: string,
    registry: ToolRegistry
  ): Promise<{ orchestrator: Orchestrator; plan: Plan } | null> {
    const snapshot = await loadCheckpoint(sessionId)
    if (!snapshot) return null

    const orchestrator = new Orchestrator(registry)
    orchestrator.sessionId = snapshot.sessionId
    orchestrator.ledger = snapshot.toolCallLedger
    orchestrator.summary = snapshot.summary

    return { orchestrator, plan: snapshot.plan }
  }

  // Model call 

  private async callModel(params: {
    system: string
    messages: Anthropic.MessageParam[]
    tools: any[]
  }): Promise<Result<Anthropic.Message, AgentError>> {
    try {
      const msg = await anthropicRateLimiter.wrap(() =>
        this.client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: params.system,
          messages: params.messages,
          ...(params.tools.length > 0
            ? { tools: params.tools as Anthropic.Tool[] }
            : {}),
        })
      )
      if (msg.usage) {
        await obsLogger.logTokenUsage(this.sessionId, params.system.slice(0, 30), msg.usage.input_tokens, msg.usage.output_tokens)
      }
      return ok(msg)
    } catch (e) {
      const error = e as Error & { status?: number }
      return err({
        code: "TOOL_EXECUTION_FAILED",
        message: error.message,
        retryable: error.status === 429 || error.status === 529,
        cause: e,
      })
    }
  }

  private executorSystemPrompt(cwd: string): string {
    return `You are an expert software engineer agent executing repository tasks.
Working directory: ${cwd}
You have access to git, GitHub, code editing, and shell tools.
Execute the current step precisely. Use tools as needed.
When done, summarise what you accomplished in plain text.
Be methodical: read before writing, verify after changing.`
  }
}