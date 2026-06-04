#!/usr/bin/env node
import { createRegistry } from "../../tools/src"
import { Orchestrator } from "./orchestrator.js"
import * as readline from "readline"
import * as fs from "fs/promises"

//  CLI 

const args = process.argv.slice(2)
const command = args[0]

async function main() {
    if (!command || command === "help") {
        printHelp()
        return
    }

    if (command === "run") {
        await runCommand()
        return
    }

    if (command === "resume") {
        await resumeCommand()
        return
    }

    if (command === "tools") {
        listTools()
        return
    }

    console.error(`Unknown command: ${command}`)
    printHelp()
    process.exit(1)
}

// ─── run ──────────────────────────────────────────────────────────────────────

async function runCommand() {
    const goal = args.slice(1).join(" ")

    if (!goal) {
        // Interactive mode
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        })

        rl.question("Enter goal: ", async (input) => {
            rl.close()
            await runGoal(input.trim())
        })
        return
    }

    await runGoal(goal)
}

async function runGoal(goal: string) {
    const cwd = process.env.REPO_PATH ?? process.cwd()
    const apiKey = process.env.ANTHROPIC_API_KEY

    if (!apiKey) {
        console.error("[error] ANTHROPIC_API_KEY environment variable is required")
        process.exit(1)
    }

    console.log(`[cli] Working directory: ${cwd}`)
    console.log(`[cli] Goal: ${goal}\n`)

    const registry = createRegistry()
    const orchestrator = new Orchestrator(registry, apiKey)

    const result = await orchestrator.run(goal, cwd)

    if (result.ok) {
        console.log(`\n[cli] ✓ Done: ${result.value}`)
        process.exit(0)
    } else {
        console.error(`\n[cli] ✗ Failed: ${result.error.message}`)
        process.exit(1)
    }
}

// ─── resume ───────────────────────────────────────────────────────────────────

async function resumeCommand() {
    const sessionId = args[1]

    if (!sessionId) {
        // List available checkpoints
        try {
            const files = await fs.readdir(".agent-checkpoints")
            if (files.length === 0) {
                console.log("No checkpoints found.")
                return
            }
            console.log("Available sessions:")
            for (const f of files) {
                console.log(`  ${f.replace(".json", "")}`)
            }
        } catch {
            console.log("No checkpoints directory found.")
        }
        return
    }

    const registry = createRegistry()
    const resumed = await Orchestrator.resume(sessionId, registry)

    if (!resumed) {
        console.error(`[cli] No checkpoint found for session: ${sessionId}`)
        process.exit(1)
    }

    const { orchestrator, plan } = resumed
    const pendingSteps = plan.steps.filter(
        (s) => s.status === "pending" || s.status === "failed"
    )

    console.log(`[cli] Resuming session ${sessionId}`)
    console.log(`[cli] Goal: ${plan.goal}`)
    console.log(`[cli] Pending steps: ${pendingSteps.length}`)

    const cwd = process.env.REPO_PATH ?? process.cwd()
    const result = await orchestrator.run(plan.goal, cwd)

    if (result.ok) {
        console.log(`\n[cli] ✓ Done: ${result.value}`)
    } else {
        console.error(`\n[cli] ✗ Failed: ${result.error.message}`)
        process.exit(1)
    }
}

// ─── tools ────────────────────────────────────────────────────────────────────

function listTools() {
    const registry = createRegistry()
    const summary = registry.summary()

    console.log(`\nTotal tools: ${registry.size}\n`)
    for (const [ns, count] of Object.entries(summary)) {
        console.log(`${ns}.* (${count} tools)`)
        for (const name of registry.list().filter((n) => n.startsWith(`${ns}.`))) {
            const tool = registry.get(name)
            console.log(`  ├── ${name}`)
            console.log(`  │   ${tool?.description ?? ""}`)
        }
        console.log("")
    }
}

// ─── help ─────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log(`
RepoAgent — autonomous repository agent

Usage:
  agent run "<goal>"          Run a goal against the current repo
  agent run                   Interactive mode (prompts for goal)
  agent resume [session-id]   Resume an interrupted session
  agent tools                 List all available tools
  agent help                  Show this help

Environment variables:
  ANTHROPIC_API_KEY           Required — your Anthropic API key
  REPO_PATH                   Repository path (defaults to cwd)
  GITHUB_TOKEN                GitHub personal access token for github.* tools

Examples:
  agent run "fix the failing auth tests"
  agent run "review PR #42 and post comments"
  agent run "refactor src/utils/token.ts to use the new JWT library"
  agent resume 550e8400-e29b-41d4-a716-446655440000
`)
}

main().catch((e) => {
    console.error("[fatal]", e)
    process.exit(1)
})