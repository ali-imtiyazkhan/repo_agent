# MEMO: Production-Shaped Autonomous Coding Agent

## Architectural Overview
This repository contains `repo-agent`, a production-grade autonomous agent framework engineered to plan, execute, and verify code modifications in software repositories. The architecture is modularized into dedicated packages: `@repo-agent/shared` (core utils, rate-limiting, observability), `@repo-agent/tools` (tool definitions and dynamic registry), `@repo-agent/subagents` (isolated execution contexts), `@repo-agent/agent` (main orchestrator), and `@repo-agent/evals` (harness & benchmark suites).

---

## Fulfilling the Five Properties

1. **51 Dynamic Tools Across 5 Namespaces**: We support 51 tools across `git`, `github`, `code`, `shell`, and `agent` namespaces. The registry uses dynamic lookup and exports definitions in Anthropic’s format. Tool dispatching is purely dynamic and model-driven, preventing switch-case dispatches or conditional loops.
2. **Subagent Orchestration**: Spawns a fully isolated `ReviewerSubagent` execution context with its own Anthropic API messages history, a scoped toolset (`code.readFile`, `git.diff`, etc.), and strict structured JSON outputs that parse and return review comments directly to the parent runner.
3. **Long-Horizon Execution**: The main orchestrator incorporates a token-limit tracker. Once token usage approaches 75% of the budget, it runs a summarization loop to compress context history without plan loss. In addition, it checkpoints session states to `.agent-checkpoints/<session-id>.json` to recover from interruptions.
4. **Production Scaffolding**: 
   - **Observability**: Records all step updates, tool invocations, cost/token metrics, durations, and errors into a structured `.agent-logs/trace.jsonl` file.
   - **Rate Limiting**: Implements a shared concurrency and inter-request delay rate-limiter wrapping Anthropic calls.
   - **Retries**: Exponential backoff with jitter handles network flakiness.
   - **Tests & Evals**: Unit test suite configured via Vitest; evaluation benchmark harness verifies code changes automatically.
5. **Composable Tool Inputs/Outputs**: Designed with composable interfaces. For example, `git.diff` produces a structured patch which is passed as direct input to `agent.runReviewer` (subagent review) and then processed by `code.applyPatch`.

---

## Engineering Trade-offs & Decisions

### What Was Cut
- **Containerized Sandboxing**: For safety, shell tools should run inside a Docker container. We cut this to focus on typescript-native tool execution in `/tmp` paths due to development constraints.
- **Parallel Subagent Execution**: Subagents run sequentially. Real-world platforms could run linting and review tasks concurrently.

### Future Work
- **Sandbox Security**: Run shell commands inside secure VM micro-sandboxes.
- **Enhanced AST Queries**: Extend ts-morph support to Python and Go.
- **Cost Analytics**: Translate token counts directly into billing estimates.

### Design Decision Defense
*We chose to decouple the Verifier agent from the Executor agent instead of performing in-line verification in the same context.*

**Why?**
An inline verification loop (asking the same model context to verify its own work) is highly vulnerable to **confirmation bias**—the model tends to assume its generated code is correct and ignores subtle bugs. Decoupling the verifier into an independent run with a custom system prompt and a read-only subset of tools (`VERIFIER_TOOLS`) ensures an objective, side-effect-free evaluation. This mirrors the real-world software engineering partition between Developer and QA/Code Reviewer.
