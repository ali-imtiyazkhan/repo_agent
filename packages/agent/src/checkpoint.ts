import * as fs from "fs/promises"
import * as path from "path"
import type { ContextSnapshot, Plan, ToolCallRecord } from "@repo-agent/shared"

const CHECKPOINT_DIR = ".agent-checkpoints"

export async function saveCheckpoint(
    sessionId: string,
    plan: Plan,
    ledger: ToolCallRecord[],
    summary: string
): Promise<void> {
    try {
        await fs.mkdir(CHECKPOINT_DIR, { recursive: true })
        const snapshot: ContextSnapshot = {
            sessionId,
            plan,
            toolCallLedger: ledger,
            summary,
            checkpointedAt: Date.now(),
        }
        const file = path.join(CHECKPOINT_DIR, `${sessionId}.json`)
        await fs.writeFile(file, JSON.stringify(snapshot, null, 2), "utf-8")
    } catch {
        // Checkpoint failures are non-fatal
    }
}

export async function loadCheckpoint(
    sessionId: string
): Promise<ContextSnapshot | null> {
    try {
        const file = path.join(CHECKPOINT_DIR, `${sessionId}.json`)
        const raw = await fs.readFile(file, "utf-8")
        return JSON.parse(raw) as ContextSnapshot
    } catch {
        return null
    }
}
