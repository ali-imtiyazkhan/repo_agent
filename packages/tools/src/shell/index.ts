import { z } from "zod"
import { ok, err } from "@repo-agent/shared"
import type { Tool } from "@repo-agent/shared"
import { execa, execaCommand } from "execa"
import * as fs from "fs/promises"
import * as path from "path"
import { createHash } from "crypto"

// shell.exec

export const shellExec: Tool<
    {
        command: string
        cwd: string
        env?: Record<string, string> | undefined
        timeoutMs?: number | undefined
    },
    {
        stdout: string
        stderr: string
        exitCode: number
        durationMs: number
    }
> = {
    namespace: "shell",
    name: "exec",
    description: "Execute a shell command in a given directory with optional env vars and timeout",
    inputSchema: z.object({
        command: z.string().describe("Shell command to run"),
        cwd: z.string().describe("Working directory"),
        env: z.record(z.string()).optional().describe("Additional environment variables"),
        timeoutMs: z.number().optional().describe("Timeout in milliseconds, default 30000"),
    }),
    outputSchema: z.object({
        stdout: z.string(),
        stderr: z.string(),
        exitCode: z.number(),
        durationMs: z.number(),
    }),
    async execute(input) {
        const { command, cwd, env, timeoutMs = 30_000 } = input
        const start = Date.now()
        try {
            const result = await execaCommand(command, {
                cwd,
                shell: true,
                timeout: timeoutMs,
                reject: false,
                env: { ...process.env, ...env },
            })
            return ok({
                stdout: result.stdout ?? "",
                stderr: result.stderr ?? "",
                exitCode: result.exitCode ?? 0,
                durationMs: Date.now() - start,
            })
        } catch (e) {
            return err({
                code: "SHELL_ERROR",
                message: (e as Error).message,
                toolName: "shell.exec",
                retryable: true,
                cause: e,
            })
        }
    },
}

// ─── shell.runTests ───────────────────────────────────────────────────────────

export const shellRunTests: Tool<
    {
        cwd: string
        pattern?: string | undefined
        reporter?: "verbose" | "json" | "dot" | undefined
        coverage?: boolean | undefined
        timeoutMs?: number | undefined
    },
    {
        passed: boolean
        total: number
        passed_count: number
        failed_count: number
        skipped_count: number
        duration: number
        failures: Array<{ name: string; message: string; file: string }>
        coverage?: { lines: number; functions: number; branches: number } | undefined
    }
> = {
    namespace: "shell",
    name: "runTests",
    description: "Run the test suite using vitest and return structured results",
    inputSchema: z.object({
        cwd: z.string(),
        pattern: z.string().optional().describe("Test file pattern to match"),
        reporter: z.enum(["verbose", "json", "dot"]).optional(),
        coverage: z.boolean().optional().describe("Collect coverage report"),
        timeoutMs: z.number().optional(),
    }),
    outputSchema: z.object({
        passed: z.boolean(),
        total: z.number(),
        passed_count: z.number(),
        failed_count: z.number(),
        skipped_count: z.number(),
        duration: z.number(),
        failures: z.array(
            z.object({ name: z.string(), message: z.string(), file: z.string() })
        ),
        coverage: z
            .object({
                lines: z.number(),
                functions: z.number(),
                branches: z.number(),
            })
            .optional(),
    }),
    async execute(input) {
        const { cwd, pattern, reporter = "json", coverage = false, timeoutMs = 60_000 } = input
        try {
            const patternArg = pattern ? pattern : ""
            const coverageArg = coverage ? "--coverage" : ""
            const cmd = `npx vitest run ${patternArg} --reporter=json ${coverageArg}`

            const result = await execaCommand(cmd, {
                cwd,
                shell: true,
                reject: false,
                timeout: timeoutMs,
            })

            // Vitest outputs JSON to stdout when --reporter=json
            const raw = result.stdout + result.stderr
            const jsonMatch = raw.match(/\{[\s\S]*\}/)

            if (!jsonMatch) {
                // Fallback: parse text output
                const passed = result.exitCode === 0
                return ok({
                    passed,
                    total: 0,
                    passed_count: 0,
                    failed_count: passed ? 0 : 1,
                    skipped_count: 0,
                    duration: 0,
                    failures: passed
                        ? []
                        : [{ name: "unknown", message: result.stderr, file: "" }],
                })
            }

            const json = JSON.parse(jsonMatch[0]) as {
                numTotalTests?: number
                numPassedTests?: number
                numFailedTests?: number
                numPendingTests?: number
                testResults?: Array<{
                    testFilePath: string
                    testResults: Array<{
                        fullName: string
                        status: string
                        failureMessages: string[]
                    }>
                }>
                coverageMap?: {
                    total?: {
                        lines?: { pct?: number }
                        functions?: { pct?: number }
                        branches?: { pct?: number }
                    }
                }
            }

            const failures: Array<{ name: string; message: string; file: string }> = []

            for (const suite of json.testResults ?? []) {
                for (const test of suite.testResults ?? []) {
                    if (test.status === "failed") {
                        failures.push({
                            name: test.fullName,
                            message: test.failureMessages.join("\n"),
                            file: suite.testFilePath,
                        })
                    }
                }
            }

            return ok({
                passed: (json.numFailedTests ?? 0) === 0,
                total: json.numTotalTests ?? 0,
                passed_count: json.numPassedTests ?? 0,
                failed_count: json.numFailedTests ?? 0,
                skipped_count: json.numPendingTests ?? 0,
                duration: 0,
                failures,
                coverage: json.coverageMap?.total
                    ? {
                        lines: json.coverageMap.total.lines?.pct ?? 0,
                        functions: json.coverageMap.total.functions?.pct ?? 0,
                        branches: json.coverageMap.total.branches?.pct ?? 0,
                    }
                    : undefined,
            })
        } catch (e) {
            return err({
                code: "SHELL_ERROR",
                message: (e as Error).message,
                toolName: "shell.runTests",
                retryable: true,
                cause: e,
            })
        }
    },
}

// ─── shell.install ────────────────────────────────────────────────────────────

export const shellInstall: Tool<
    {
        cwd: string
        packages?: string[] | undefined
        dev?: boolean | undefined
        packageManager?: "npm" | "pnpm" | "yarn" | undefined
    },
    { success: boolean; stdout: string; installedCount: number }
> = {
    namespace: "shell",
    name: "install",
    description: "Install npm/pnpm/yarn packages in a project directory",
    inputSchema: z.object({
        cwd: z.string(),
        packages: z
            .array(z.string())
            .optional()
            .describe("Packages to install; omit to run plain install"),
        dev: z.boolean().optional().describe("Install as devDependencies"),
        packageManager: z.enum(["npm", "pnpm", "yarn"]).optional(),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        stdout: z.string(),
        installedCount: z.number(),
    }),
    async execute(input) {
        const { cwd, packages, dev = false, packageManager = "pnpm" } = input
        try {
            let cmd: string
            if (!packages || packages.length === 0) {
                cmd = `${packageManager} install`
            } else {
                const devFlag =
                    packageManager === "npm"
                        ? "--save-dev"
                        : packageManager === "yarn"
                            ? "--dev"
                            : "-D"
                cmd = `${packageManager} add ${dev ? devFlag : ""} ${packages.join(" ")}`
            }

            const result = await execaCommand(cmd, {
                cwd,
                shell: true,
                reject: false,
                timeout: 120_000,
            })

            return ok({
                success: result.exitCode === 0,
                stdout: result.stdout ?? "",
                installedCount: packages?.length ?? 0,
            })
        } catch (e) {
            return err({
                code: "SHELL_ERROR",
                message: (e as Error).message,
                toolName: "shell.install",
                retryable: true,
                cause: e,
            })
        }
    },
}

// ─── shell.build ──────────────────────────────────────────────────────────────

export const shellBuild: Tool<
    { cwd: string; script?: string | undefined; env?: Record<string, string> | undefined },
    { success: boolean; stdout: string; stderr: string; durationMs: number }
> = {
    namespace: "shell",
    name: "build",
    description: "Run the build script for a project",
    inputSchema: z.object({
        cwd: z.string(),
        script: z
            .string()
            .optional()
            .describe("Build script name, defaults to 'build'"),
        env: z.record(z.string()).optional(),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        stdout: z.string(),
        stderr: z.string(),
        durationMs: z.number(),
    }),
    async execute(input) {
        const { cwd, script = "build", env } = input
        const start = Date.now()
        try {
            const result = await execaCommand(`pnpm run ${script}`, {
                cwd,
                shell: true,
                reject: false,
                timeout: 120_000,
                env: { ...process.env, ...env },
            })
            return ok({
                success: result.exitCode === 0,
                stdout: result.stdout ?? "",
                stderr: result.stderr ?? "",
                durationMs: Date.now() - start,
            })
        } catch (e) {
            return err({
                code: "SHELL_ERROR",
                message: (e as Error).message,
                toolName: "shell.build",
                retryable: true,
                cause: e,
            })
        }
    },
}

// ─── shell.readEnv ────────────────────────────────────────────────────────────

export const shellReadEnv: Tool<
    { cwd: string; keys?: string[] | undefined },
    { env: Record<string, string>; envFileExists: boolean }
> = {
    namespace: "shell",
    name: "readEnv",
    description: "Read environment variables from .env file or current process env",
    inputSchema: z.object({
        cwd: z.string(),
        keys: z
            .array(z.string())
            .optional()
            .describe("Specific keys to read; omit for all"),
    }),
    outputSchema: z.object({
        env: z.record(z.string()),
        envFileExists: z.boolean(),
    }),
    async execute(input) {
        const { cwd, keys } = input
        try {
            const envPath = path.join(cwd, ".env")
            let envVars: Record<string, string> = {}
            let envFileExists = false

            try {
                const content = await fs.readFile(envPath, "utf-8")
                envFileExists = true
                for (const line of content.split("\n")) {
                    const trimmed = line.trim()
                    if (!trimmed || trimmed.startsWith("#")) continue
                    const eqIdx = trimmed.indexOf("=")
                    if (eqIdx === -1) continue
                    const key = trimmed.slice(0, eqIdx).trim()
                    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
                    envVars[key] = value
                }
            } catch {
                // No .env file — use process.env
                envVars = Object.fromEntries(
                    Object.entries(process.env).filter(([, v]) => v !== undefined)
                ) as Record<string, string>
            }

            const filtered = keys
                ? Object.fromEntries(
                    keys.map((k) => [k, envVars[k] ?? ""])
                )
                : envVars

            // Redact secrets from output
            const redacted = Object.fromEntries(
                Object.entries(filtered).map(([k, v]) => {
                    const lower = k.toLowerCase()
                    if (
                        lower.includes("secret") ||
                        lower.includes("password") ||
                        lower.includes("token") ||
                        lower.includes("key")
                    ) {
                        return [k, v ? "***redacted***" : ""]
                    }
                    return [k, v]
                })
            )

            return ok({ env: redacted, envFileExists })
        } catch (e) {
            return err({
                code: "SHELL_ERROR",
                message: (e as Error).message,
                toolName: "shell.readEnv",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── shell.hashFile ───────────────────────────────────────────────────────────

export const shellHashFile: Tool<
    { filePath: string; algorithm?: "md5" | "sha1" | "sha256" | undefined },
    { hash: string; algorithm: string; sizeBytes: number }
> = {
    namespace: "shell",
    name: "hashFile",
    description: "Compute a hash of a file to detect changes or verify integrity",
    inputSchema: z.object({
        filePath: z.string(),
        algorithm: z.enum(["md5", "sha1", "sha256"]).optional(),
    }),
    outputSchema: z.object({
        hash: z.string(),
        algorithm: z.string(),
        sizeBytes: z.number(),
    }),
    async execute(input) {
        const { filePath, algorithm = "sha256" } = input
        try {
            const content = await fs.readFile(filePath)
            const stat = await fs.stat(filePath)
            const hash = createHash(algorithm).update(content).digest("hex")
            return ok({ hash, algorithm, sizeBytes: stat.size })
        } catch (e) {
            return err({
                code: "FILE_NOT_FOUND",
                message: (e as Error).message,
                toolName: "shell.hashFile",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── shell.which ──────────────────────────────────────────────────────────────

export const shellWhich: Tool<
    { commands: string[] },
    { available: Record<string, boolean>; paths: Record<string, string> }
> = {
    namespace: "shell",
    name: "which",
    description: "Check which commands are available in the system PATH",
    inputSchema: z.object({
        commands: z.array(z.string()).describe("Command names to check"),
    }),
    outputSchema: z.object({
        available: z.record(z.boolean()),
        paths: z.record(z.string()),
    }),
    async execute(input) {
        const { commands } = input
        try {
            const available: Record<string, boolean> = {}
            const paths: Record<string, string> = {}

            for (const cmd of commands) {
                try {
                    const result = await execaCommand(`which ${cmd}`, {
                        shell: true,
                        reject: false,
                    })
                    available[cmd] = result.exitCode === 0
                    paths[cmd] = result.stdout.trim()
                } catch {
                    available[cmd] = false
                    paths[cmd] = ""
                }
            }

            return ok({ available, paths })
        } catch (e) {
            return err({
                code: "SHELL_ERROR",
                message: (e as Error).message,
                toolName: "shell.which",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── shell.killProcess ────────────────────────────────────────────────────────

export const shellKillProcess: Tool<
    { pid: number; signal?: "SIGTERM" | "SIGKILL" | "SIGINT" | undefined },
    { killed: boolean; pid: number }
> = {
    namespace: "shell",
    name: "killProcess",
    description: "Send a signal to a running process by PID",
    inputSchema: z.object({
        pid: z.number().describe("Process ID to signal"),
        signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT"]).optional(),
    }),
    outputSchema: z.object({ killed: z.boolean(), pid: z.number() }),
    async execute(input) {
        const { pid, signal = "SIGTERM" } = input
        try {
            process.kill(pid, signal)
            return ok({ killed: true, pid })
        } catch (e) {
            return err({
                code: "SHELL_ERROR",
                message: (e as Error).message,
                toolName: "shell.killProcess",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── shell.writeEnvFile ───────────────────────────────────────────────────────

export const shellWriteEnvFile: Tool<
    { cwd: string; vars: Record<string, string>; merge?: boolean | undefined },
    { written: boolean; path: string; keyCount: number }
> = {
    namespace: "shell",
    name: "writeEnvFile",
    description: "Write or merge environment variables into a .env file",
    inputSchema: z.object({
        cwd: z.string(),
        vars: z.record(z.string()).describe("Key-value pairs to write"),
        merge: z
            .boolean()
            .optional()
            .describe("Merge with existing .env instead of overwriting"),
    }),
    outputSchema: z.object({
        written: z.boolean(),
        path: z.string(),
        keyCount: z.number(),
    }),
    async execute(input) {
        const { cwd, vars, merge = true } = input
        try {
            const envPath = path.join(cwd, ".env")
            let existing: Record<string, string> = {}

            if (merge) {
                try {
                    const content = await fs.readFile(envPath, "utf-8")
                    for (const line of content.split("\n")) {
                        const trimmed = line.trim()
                        if (!trimmed || trimmed.startsWith("#")) continue
                        const eqIdx = trimmed.indexOf("=")
                        if (eqIdx === -1) continue
                        existing[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
                    }
                } catch {
                    // file doesn't exist yet, start fresh
                }
            }

            const merged = { ...existing, ...vars }
            const content = Object.entries(merged)
                .map(([k, v]) => `${k}=${v}`)
                .join("\n")

            await fs.writeFile(envPath, content + "\n", "utf-8")
            return ok({ written: true, path: envPath, keyCount: Object.keys(merged).length })
        } catch (e) {
            return err({
                code: "SHELL_ERROR",
                message: (e as Error).message,
                toolName: "shell.writeEnvFile",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── shell.scriptRunner ───────────────────────────────────────────────────────

export const shellScriptRunner: Tool<
    {
        cwd: string
        script: string
        args?: string[] | undefined
        env?: Record<string, string> | undefined
        timeoutMs?: number | undefined
    },
    {
        stdout: string
        stderr: string
        exitCode: number
        durationMs: number
        success: boolean
    }
> = {
    namespace: "shell",
    name: "scriptRunner",
    description: "Run a package.json script by name with optional arguments",
    inputSchema: z.object({
        cwd: z.string(),
        script: z.string().describe("package.json script name"),
        args: z.array(z.string()).optional().describe("Arguments to pass to the script"),
        env: z.record(z.string()).optional(),
        timeoutMs: z.number().optional(),
    }),
    outputSchema: z.object({
        stdout: z.string(),
        stderr: z.string(),
        exitCode: z.number(),
        durationMs: z.number(),
        success: z.boolean(),
    }),
    async execute(input) {
        const { cwd, script, args = [], env, timeoutMs = 60_000 } = input
        const start = Date.now()
        try {
            const argsStr = args.join(" ")
            const result = await execaCommand(
                `pnpm run ${script} ${argsStr}`.trim(),
                {
                    cwd,
                    shell: true,
                    reject: false,
                    timeout: timeoutMs,
                    env: { ...process.env, ...env },
                }
            )
            return ok({
                stdout: result.stdout ?? "",
                stderr: result.stderr ?? "",
                exitCode: result.exitCode ?? 0,
                durationMs: Date.now() - start,
                success: result.exitCode === 0,
            })
        } catch (e) {
            return err({
                code: "SHELL_ERROR",
                message: (e as Error).message,
                toolName: "shell.scriptRunner",
                retryable: true,
                cause: e,
            })
        }
    },
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const shellTools = [
    shellExec,
    shellRunTests,
    shellInstall,
    shellBuild,
    shellReadEnv,
    shellHashFile,
    shellWhich,
    shellKillProcess,
    shellWriteEnvFile,
    shellScriptRunner,
]