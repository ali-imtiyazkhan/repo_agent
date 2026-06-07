# repo-agent

Production-shaped autonomous coding agent for software repositories. Given a goal, it plans steps, executes them with tools, verifies results, and checkpoints progress for long-running sessions.

## Packages

| Package | Description |
|---------|-------------|
| `@repo-agent/shared` | Types, retries, rate limiting, observability |
| `@repo-agent/tools` | 52 tools across `git`, `github`, `code`, `shell`, `agent` |
| `@repo-agent/subagents` | Isolated subagents (reviewer, linter, test runner) |
| `@repo-agent/agent` | Orchestrator, planner, CLI |
| `@repo-agent/evals` | Benchmark harness and scoring |

## Setup

```sh
pnpm install
cp .env.example .env
# Add your GEMINI_API_KEY from https://aistudio.google.com/app/api-keys
pnpm build
```

## Usage

```sh
# List available tools
pnpm agent tools

# Run a goal against the current directory
pnpm agent:run "fix the failing tests in src/utils.ts"

# Resume an interrupted session
pnpm agent resume <session-id>

# Run all eval fixtures
pnpm eval

# Run a single eval fixture
pnpm eval:single fix-syntax-error
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `GEMINI_MODEL` | No | Model name (default: `gemini-flash-latest`) |
| `REPO_PATH` | No | Target repo path (default: cwd) |
| `GITHUB_TOKEN` | No | GitHub PAT for `github.*` tools |

## Architecture

```
Goal → Planner → Orchestrator (execute + verify loop) → Done
                      ↓
              Tool Registry (52 tools)
                      ↓
              Subagents (reviewer, etc.)
```

Sessions are logged to `.agent-logs/trace.jsonl` and checkpointed to `.agent-checkpoints/`.
