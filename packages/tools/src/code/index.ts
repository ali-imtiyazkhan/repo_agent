import { z } from "zod"
import { ok, err } from "@repo-agent/shared"
import type { Tool } from "@repo-agent/shared"
import * as fs from "fs/promises"
import * as path from "path"
import { Project, SyntaxKind } from "ts-morph"
import { execaCommand } from "execa"

//  code.readFile

export const codeReadFile: Tool<
    { filePath: string; startLine?: number | undefined; endLine?: number | undefined },
    { content: string; lines: number; sizeBytes: number }
> = {
    namespace: "code",
    name: "readFile",
    description: "Read the contents of a file, optionally scoped to a line range",
    inputSchema: z.object({
        filePath: z.string().describe("Absolute or relative path to the file"),
        startLine: z.number().optional().describe("Start line (1-indexed)"),
        endLine: z.number().optional().describe("End line (1-indexed, inclusive)"),
    }),
    outputSchema: z.object({
        content: z.string(),
        lines: z.number(),
        sizeBytes: z.number(),
    }),
    async execute(input) {
        const { filePath, startLine, endLine } = input
        try {
            const raw = await fs.readFile(filePath, "utf-8")
            const allLines = raw.split("\n")
            const sliced =
                startLine !== undefined && endLine !== undefined
                    ? allLines.slice(startLine - 1, endLine)
                    : allLines
            return ok({
                content: sliced.join("\n"),
                lines: sliced.length,
                sizeBytes: Buffer.byteLength(raw, "utf-8"),
            })
        } catch (e) {
            return err({
                code: "FILE_NOT_FOUND",
                message: (e as Error).message,
                toolName: "code.readFile",
                retryable: false,
                cause: e,
            })
        }
    },
}

//  code.writeFile 

export const codeWriteFile: Tool<
    { filePath: string; content: string; createDirs?: boolean | undefined },
    { written: boolean; sizeBytes: number }
> = {
    namespace: "code",
    name: "writeFile",
    description: "Write content to a file, optionally creating parent directories",
    inputSchema: z.object({
        filePath: z.string(),
        content: z.string().describe("Full file content to write"),
        createDirs: z
            .boolean()
            .optional()
            .describe("Create parent directories if they don't exist"),
    }),
    outputSchema: z.object({ written: z.boolean(), sizeBytes: z.number() }),
    async execute(input) {
        const { filePath, content, createDirs = true } = input
        try {
            if (createDirs) {
                await fs.mkdir(path.dirname(filePath), { recursive: true })
            }
            await fs.writeFile(filePath, content, "utf-8")
            return ok({
                written: true,
                sizeBytes: Buffer.byteLength(content, "utf-8"),
            })
        } catch (e) {
            return err({
                code: "TOOL_EXECUTION_FAILED",
                message: (e as Error).message,
                toolName: "code.writeFile",
                retryable: false,
                cause: e,
            })
        }
    },
}

//  code.deleteFile 

export const codeDeleteFile: Tool<
    { filePath: string },
    { deleted: boolean }
> = {
    namespace: "code",
    name: "deleteFile",
    description: "Delete a file from the filesystem",
    inputSchema: z.object({ filePath: z.string() }),
    outputSchema: z.object({ deleted: z.boolean() }),
    async execute(input) {
        const { filePath } = input
        try {
            await fs.unlink(filePath)
            return ok({ deleted: true })
        } catch (e) {
            return err({
                code: "FILE_NOT_FOUND",
                message: (e as Error).message,
                toolName: "code.deleteFile",
                retryable: false,
                cause: e,
            })
        }
    },
}

//  code.listDirectory 

export const codeListDirectory: Tool<
    { dirPath: string; recursive?: boolean | undefined; extensions?: string[] | undefined },
    { files: Array<{ path: string; sizeBytes: number; isDirectory: boolean }> }
> = {
    namespace: "code",
    name: "listDirectory",
    description: "List files in a directory, optionally filtered by extension",
    inputSchema: z.object({
        dirPath: z.string(),
        recursive: z.boolean().optional().describe("List recursively"),
        extensions: z
            .array(z.string())
            .optional()
            .describe("Filter by extensions e.g. ['.ts', '.js']"),
    }),
    outputSchema: z.object({
        files: z.array(
            z.object({
                path: z.string(),
                sizeBytes: z.number(),
                isDirectory: z.boolean(),
            })
        ),
    }),
    async execute(input) {
        const { dirPath, recursive = false, extensions } = input
        try {
            const results: Array<{
                path: string
                sizeBytes: number
                isDirectory: boolean
            }> = []

            async function walk(dir: string) {
                const entries = await fs.readdir(dir, { withFileTypes: true })
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name)
                    if (
                        entry.name === "node_modules" ||
                        entry.name === ".git" ||
                        entry.name === "dist"
                    )
                        continue
                    if (entry.isDirectory()) {
                        results.push({ path: fullPath, sizeBytes: 0, isDirectory: true })
                        if (recursive) await walk(fullPath)
                    } else {
                        if (
                            !extensions ||
                            extensions.some((ext) => entry.name.endsWith(ext))
                        ) {
                            const stat = await fs.stat(fullPath)
                            results.push({
                                path: fullPath,
                                sizeBytes: stat.size,
                                isDirectory: false,
                            })
                        }
                    }
                }
            }

            await walk(dirPath)
            return ok({ files: results })
        } catch (e) {
            return err({
                code: "FILE_NOT_FOUND",
                message: (e as Error).message,
                toolName: "code.listDirectory",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── code.applyPatch ──────────────────────────────────────────────────────────
// Consumes output of git.diff — this is the composability chain:
// git.diff → verifier reviews → code.applyPatch applies
// The patch string comes directly from GitDiff output

export const codeApplyPatch: Tool<
    { cwd: string; patch: string; dryRun?: boolean | undefined },
    { applied: boolean; filesChanged: string[]; rejects: string[] }
> = {
    namespace: "code",
    name: "applyPatch",
    description:
        "Apply a unified diff patch to the working tree. Consumes output from git.diff",
    inputSchema: z.object({
        cwd: z.string(),
        patch: z.string().describe("Unified diff patch string (from git.diff output)"),
        dryRun: z
            .boolean()
            .optional()
            .describe("Check if patch applies without actually writing"),
    }),
    outputSchema: z.object({
        applied: z.boolean(),
        filesChanged: z.array(z.string()),
        rejects: z.array(z.string()),
    }),
    async execute(input) {
        const { cwd, patch, dryRun = false } = input
        try {
            const tmpFile = path.join(cwd, ".agent-patch.diff")
            await fs.writeFile(tmpFile, patch, "utf-8")

            const args = dryRun
                ? ["patch", "--dry-run", "-p1", "<", tmpFile]
                : ["patch", "-p1", "<", tmpFile]

            const result = await execaCommand(`patch ${dryRun ? "--dry-run " : ""}-p1 < ${tmpFile}`, { cwd, shell: true })

            await fs.unlink(tmpFile).catch(() => { })

            const filesChanged = (result.stdout ?? "")
                .split("\n")
                .filter((l) => l.startsWith("patching file"))
                .map((l) => l.replace("patching file ", "").trim())

            return ok({ applied: true, filesChanged, rejects: [] })
        } catch (e) {
            const msg = (e as Error).message
            const rejects = msg.match(/saving rejects to file (.*)/g)?.map((l) =>
                l.replace("saving rejects to file ", "")
            ) ?? []
            return err({
                code: "TOOL_EXECUTION_FAILED",
                message: msg,
                toolName: "code.applyPatch",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── code.searchInFiles ───────────────────────────────────────────────────────

export const codeSearchInFiles: Tool<
    {
        cwd: string
        pattern: string
        extensions?: string[] | undefined
        caseSensitive?: boolean | undefined
        maxResults?: number | undefined
    },
    {
        matches: Array<{
            file: string
            line: number
            column: number
            text: string
        }>
        totalMatches: number
    }
> = {
    namespace: "code",
    name: "searchInFiles",
    description: "Search for a pattern across all files in a directory (like grep)",
    inputSchema: z.object({
        cwd: z.string(),
        pattern: z.string().describe("Search pattern (string or regex)"),
        extensions: z.array(z.string()).optional(),
        caseSensitive: z.boolean().optional(),
        maxResults: z.number().optional(),
    }),
    outputSchema: z.object({
        matches: z.array(
            z.object({
                file: z.string(),
                line: z.number(),
                column: z.number(),
                text: z.string(),
            })
        ),
        totalMatches: z.number(),
    }),
    async execute(input) {
        const { cwd, pattern, extensions, caseSensitive = true, maxResults = 100 } = input
        try {
            const flags = caseSensitive ? "" : "i"
            const regex = new RegExp(pattern, flags + "g")
            const matches: Array<{ file: string; line: number; column: number; text: string }> = []

            async function walk(dir: string) {
                if (matches.length >= maxResults) return
                let entries
                try {
                    entries = await fs.readdir(dir, { withFileTypes: true })
                } catch { return }
                for (const entry of entries) {
                    if (matches.length >= maxResults) return
                    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name.startsWith(".")) continue
                    const fullPath = path.join(dir, entry.name)
                    if (entry.isDirectory()) {
                        await walk(fullPath)
                    } else if (!extensions || extensions.some((e: string) => entry.name.endsWith(e))) {
                        try {
                            const content = await fs.readFile(fullPath, "utf-8")
                            const lines = content.split("\n")
                            for (let i = 0; i < lines.length; i++) {
                                if (matches.length >= maxResults) break
                                const line = lines[i]
                                if (line === undefined) continue
                                regex.lastIndex = 0
                                const match = regex.exec(line)
                                if (match) {
                                    matches.push({
                                        file: fullPath,
                                        line: i + 1,
                                        column: (match.index ?? 0) + 1,
                                        text: line.trim().slice(0, 200),
                                    })
                                }
                            }
                        } catch { /* skip unreadable files */ }
                    }
                }
            }

            await walk(cwd)
            return ok({ matches, totalMatches: matches.length })
        } catch (e) {
            return err({
                code: "TOOL_EXECUTION_FAILED",
                message: (e as Error).message,
                toolName: "code.searchInFiles",
                retryable: true,
                cause: e,
            })
        }
    },
}

// ─── code.replaceInFile ───────────────────────────────────────────────────────

export const codeReplaceInFile: Tool<
    {
        filePath: string
        oldString: string
        newString: string
        occurrences?: "first" | "all" | undefined
    },
    { replacements: number; content: string }
> = {
    namespace: "code",
    name: "replaceInFile",
    description: "Replace a string or pattern inside a file",
    inputSchema: z.object({
        filePath: z.string(),
        oldString: z.string().describe("Exact string to find and replace"),
        newString: z.string().describe("Replacement string"),
        occurrences: z.enum(["first", "all"]).optional().describe("How many to replace"),
    }),
    outputSchema: z.object({ replacements: z.number(), content: z.string() }),
    async execute(input) {
        const { filePath, oldString, newString, occurrences = "all" } = input
        try {
            const content = await fs.readFile(filePath, "utf-8")
            let count = 0
            let updated: string

            if (occurrences === "first") {
                updated = content.replace(oldString, () => { count++; return newString })
            } else {
                updated = content.split(oldString).join(newString)
                count = (content.split(oldString).length - 1)
            }

            await fs.writeFile(filePath, updated, "utf-8")
            return ok({ replacements: count, content: updated })
        } catch (e) {
            return err({
                code: "TOOL_EXECUTION_FAILED",
                message: (e as Error).message,
                toolName: "code.replaceInFile",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── code.astQuery ────────────────────────────────────────────────────────────
// Uses ts-morph to query TypeScript AST — unique capability most agents lack

export const codeAstQuery: Tool<
    {
        filePath: string
        query:
        | "functions"
        | "classes"
        | "interfaces"
        | "imports"
        | "exports"
        | "types"
    },
    {
        results: Array<{
            name: string
            kind: string
            line: number
            signature: string
        }>
    }
> = {
    namespace: "code",
    name: "astQuery",
    description:
        "Query the TypeScript AST of a file to extract functions, classes, interfaces, imports, or exports",
    inputSchema: z.object({
        filePath: z.string(),
        query: z.enum(["functions", "classes", "interfaces", "imports", "exports", "types"]),
    }),
    outputSchema: z.object({
        results: z.array(
            z.object({
                name: z.string(),
                kind: z.string(),
                line: z.number(),
                signature: z.string(),
            })
        ),
    }),
    async execute(input) {
        const { filePath, query } = input
        try {
            const project = new Project({ useInMemoryFileSystem: false })
            const sourceFile = project.addSourceFileAtPath(filePath)

            const results: Array<{
                name: string
                kind: string
                line: number
                signature: string
            }> = []

            if (query === "functions") {
                for (const fn of sourceFile.getFunctions()) {
                    results.push({
                        name: fn.getName() ?? "(anonymous)",
                        kind: "function",
                        line: fn.getStartLineNumber(),
                        signature: fn.getSignature().getDeclaration().getText().slice(0, 120),
                    })
                }
                for (const arrow of sourceFile.getVariableDeclarations()) {
                    const init = arrow.getInitializer()
                    if (init && init.getKind() === SyntaxKind.ArrowFunction) {
                        results.push({
                            name: arrow.getName(),
                            kind: "arrow-function",
                            line: arrow.getStartLineNumber(),
                            signature: arrow.getText().slice(0, 120),
                        })
                    }
                }
            }

            if (query === "classes") {
                for (const cls of sourceFile.getClasses()) {
                    results.push({
                        name: cls.getName() ?? "(anonymous)",
                        kind: "class",
                        line: cls.getStartLineNumber(),
                        signature: `class ${cls.getName()} { ${cls.getMethods().length} methods }`,
                    })
                }
            }

            if (query === "interfaces") {
                for (const iface of sourceFile.getInterfaces()) {
                    results.push({
                        name: iface.getName(),
                        kind: "interface",
                        line: iface.getStartLineNumber(),
                        signature: iface.getText().slice(0, 120),
                    })
                }
            }

            if (query === "imports") {
                for (const imp of sourceFile.getImportDeclarations()) {
                    results.push({
                        name: imp.getModuleSpecifierValue(),
                        kind: "import",
                        line: imp.getStartLineNumber(),
                        signature: imp.getText(),
                    })
                }
            }

            if (query === "exports") {
                for (const exp of sourceFile.getExportDeclarations()) {
                    results.push({
                        name: exp.getModuleSpecifierValue() ?? "(re-export)",
                        kind: "export",
                        line: exp.getStartLineNumber(),
                        signature: exp.getText(),
                    })
                }
                for (const sym of sourceFile.getExportedDeclarations()) {
                    const [decl] = sym[1]
                    if (decl) {
                        results.push({
                            name: sym[0],
                            kind: "exported-symbol",
                            line: decl.getStartLineNumber(),
                            signature: decl.getText().slice(0, 120),
                        })
                    }
                }
            }

            if (query === "types") {
                for (const t of sourceFile.getTypeAliases()) {
                    results.push({
                        name: t.getName(),
                        kind: "type-alias",
                        line: t.getStartLineNumber(),
                        signature: t.getText().slice(0, 120),
                    })
                }
            }

            return ok({ results })
        } catch (e) {
            return err({
                code: "TOOL_EXECUTION_FAILED",
                message: (e as Error).message,
                toolName: "code.astQuery",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── code.lint ────────────────────────────────────────────────────────────────

export const codeLint: Tool<
    { cwd: string; files?: string[] | undefined; fix?: boolean | undefined },
    {
        passed: boolean
        errorCount: number
        warningCount: number
        errors: Array<{ file: string; line: number; message: string; rule: string }>
    }
> = {
    namespace: "code",
    name: "lint",
    description: "Run ESLint on files and optionally auto-fix issues",
    inputSchema: z.object({
        cwd: z.string(),
        files: z.array(z.string()).optional().describe("Files to lint, defaults to src/"),
        fix: z.boolean().optional().describe("Auto-fix fixable issues"),
    }),
    outputSchema: z.object({
        passed: z.boolean(),
        errorCount: z.number(),
        warningCount: z.number(),
        errors: z.array(
            z.object({
                file: z.string(),
                line: z.number(),
                message: z.string(),
                rule: z.string(),
            })
        ),
    }),
    async execute(input) {
        const { cwd, files, fix = false } = input
        try {
            const target = files?.join(" ") ?? "src/"
            const fixFlag = fix ? "--fix" : ""
            const result = await execaCommand(
                `npx eslint ${fixFlag} --format json ${target}`,
                { cwd, shell: true, reject: false }
            )

            const parsed = JSON.parse(result.stdout || "[]") as Array<{
                filePath: string
                messages: Array<{
                    line: number
                    message: string
                    ruleId: string | null
                    severity: number
                }>
                errorCount: number
                warningCount: number
            }>

            const errors = parsed.flatMap((f) =>
                f.messages
                    .filter((m) => m.severity === 2)
                    .map((m) => ({
                        file: f.filePath,
                        line: m.line,
                        message: m.message,
                        rule: m.ruleId ?? "unknown",
                    }))
            )

            const totalErrors = parsed.reduce((a, f) => a + f.errorCount, 0)
            const totalWarnings = parsed.reduce((a, f) => a + f.warningCount, 0)

            return ok({
                passed: totalErrors === 0,
                errorCount: totalErrors,
                warningCount: totalWarnings,
                errors,
            })
        } catch (e) {
            return err({
                code: "TOOL_EXECUTION_FAILED",
                message: (e as Error).message,
                toolName: "code.lint",
                retryable: true,
                cause: e,
            })
        }
    },
}

// ─── code.typecheck ───────────────────────────────────────────────────────────

export const codeTypecheck: Tool<
    { cwd: string },
    {
        passed: boolean
        errorCount: number
        errors: Array<{ file: string; line: number; message: string; code: number }>
    }
> = {
    namespace: "code",
    name: "typecheck",
    description: "Run TypeScript type checking (tsc --noEmit) on the project",
    inputSchema: z.object({ cwd: z.string() }),
    outputSchema: z.object({
        passed: z.boolean(),
        errorCount: z.number(),
        errors: z.array(
            z.object({
                file: z.string(),
                line: z.number(),
                message: z.string(),
                code: z.number(),
            })
        ),
    }),
    async execute(input) {
        const { cwd } = input
        try {
            const result = await execaCommand("npx tsc --noEmit --pretty false", {
                cwd,
                shell: true,
                reject: false,
            })

            const lines = (result.stdout + result.stderr)
                .split("\n")
                .filter(Boolean)

            const errors = lines
                .filter((l) => l.includes(": error TS"))
                .map((l) => {
                    const match = l.match(/^(.*)\((\d+),\d+\): error TS(\d+): (.*)$/)
                    if (!match) return null
                    return {
                        file: match[1] ?? "",
                        line: parseInt(match[2] ?? "0", 10),
                        message: match[4] ?? l,
                        code: parseInt(match[3] ?? "0", 10),
                    }
                })
                .filter((e): e is NonNullable<typeof e> => e !== null)

            return ok({
                passed: errors.length === 0,
                errorCount: errors.length,
                errors,
            })
        } catch (e) {
            return err({
                code: "TOOL_EXECUTION_FAILED",
                message: (e as Error).message,
                toolName: "code.typecheck",
                retryable: true,
                cause: e,
            })
        }
    },
}

// ─── code.findSymbol ──────────────────────────────────────────────────────────

export const codeFindSymbol: Tool<
    { cwd: string; symbol: string; extensions?: string[] | undefined },
    {
        occurrences: Array<{
            file: string
            line: number
            kind: string
            context: string
        }>
    }
> = {
    namespace: "code",
    name: "findSymbol",
    description: "Find all occurrences of a symbol (function, class, variable) across the codebase",
    inputSchema: z.object({
        cwd: z.string(),
        symbol: z.string().describe("Symbol name to search for"),
        extensions: z
            .array(z.string())
            .optional()
            .describe("File extensions to search, default ['.ts', '.tsx']"),
    }),
    outputSchema: z.object({
        occurrences: z.array(
            z.object({
                file: z.string(),
                line: z.number(),
                kind: z.string(),
                context: z.string(),
            })
        ),
    }),
    async execute(input) {
        const { cwd, symbol, extensions = [".ts", ".tsx"] } = input
        try {
            const project = new Project({ useInMemoryFileSystem: false })
            const extFilter = extensions.map((e) => `**/*${e}`)

            project.addSourceFilesAtPaths(
                extFilter.map((g) => path.join(cwd, g))
            )

            const occurrences: Array<{
                file: string
                line: number
                kind: string
                context: string
            }> = []

            for (const sourceFile of project.getSourceFiles()) {
                if (sourceFile.getFilePath().includes("node_modules")) continue
                if (sourceFile.getFilePath().includes("dist")) continue

                const refs = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)
                    .filter((id) => id.getText() === symbol)

                for (const ref of refs) {
                    occurrences.push({
                        file: sourceFile.getFilePath(),
                        line: ref.getStartLineNumber(),
                        kind: ref.getParent()?.getKindName() ?? "Identifier",
                        context: ref.getParent()?.getText().slice(0, 100) ?? "",
                    })
                }
            }

            return ok({ occurrences })
        } catch (e) {
            return err({
                code: "TOOL_EXECUTION_FAILED",
                message: (e as Error).message,
                toolName: "code.findSymbol",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── code.getFileSummary ──────────────────────────────────────────────────────

export const codeGetFileSummary: Tool<
    { filePath: string },
    {
        language: string
        lines: number
        functions: number
        classes: number
        imports: number
        exports: number
        sizeBytes: number
        topLevelSymbols: string[]
    }
> = {
    namespace: "code",
    name: "getFileSummary",
    description: "Get a structural summary of a source file without reading the full content",
    inputSchema: z.object({ filePath: z.string() }),
    outputSchema: z.object({
        language: z.string(),
        lines: z.number(),
        functions: z.number(),
        classes: z.number(),
        imports: z.number(),
        exports: z.number(),
        sizeBytes: z.number(),
        topLevelSymbols: z.array(z.string()),
    }),
    async execute(input) {
        const { filePath } = input
        try {
            const raw = await fs.readFile(filePath, "utf-8")
            const stat = await fs.stat(filePath)
            const ext = path.extname(filePath)
            const isTs = [".ts", ".tsx"].includes(ext)

            let functions = 0
            let classes = 0
            let imports = 0
            let exports = 0
            const topLevelSymbols: string[] = []

            if (isTs) {
                const project = new Project({ useInMemoryFileSystem: false })
                const sf = project.addSourceFileAtPath(filePath)
                functions = sf.getFunctions().length
                classes = sf.getClasses().length
                imports = sf.getImportDeclarations().length
                exports = sf.getExportDeclarations().length
                topLevelSymbols.push(
                    ...sf.getFunctions().map((f) => f.getName() ?? ""),
                    ...sf.getClasses().map((c) => c.getName() ?? ""),
                    ...sf.getInterfaces().map((i) => i.getName()),
                    ...sf.getTypeAliases().map((t) => t.getName())
                )
            }

            return ok({
                language: ext.replace(".", "") || "unknown",
                lines: raw.split("\n").length,
                functions,
                classes,
                imports,
                exports,
                sizeBytes: stat.size,
                topLevelSymbols: topLevelSymbols.filter(Boolean),
            })
        } catch (e) {
            return err({
                code: "FILE_NOT_FOUND",
                message: (e as Error).message,
                toolName: "code.getFileSummary",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── code.moveFile ────────────────────────────────────────────────────────────

export const codeMoveFile: Tool<
    { fromPath: string; toPath: string; createDirs?: boolean | undefined },
    { moved: boolean; from: string; to: string }
> = {
    namespace: "code",
    name: "moveFile",
    description: "Move or rename a file",
    inputSchema: z.object({
        fromPath: z.string(),
        toPath: z.string(),
        createDirs: z.boolean().optional(),
    }),
    outputSchema: z.object({
        moved: z.boolean(),
        from: z.string(),
        to: z.string(),
    }),
    async execute(input) {
        const { fromPath, toPath, createDirs = true } = input
        try {
            if (createDirs) {
                await fs.mkdir(path.dirname(toPath), { recursive: true })
            }
            await fs.rename(fromPath, toPath)
            return ok({ moved: true, from: fromPath, to: toPath })
        } catch (e) {
            return err({
                code: "TOOL_EXECUTION_FAILED",
                message: (e as Error).message,
                toolName: "code.moveFile",
                retryable: false,
                cause: e,
            })
        }
    },
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const codeTools = [
    codeReadFile,
    codeWriteFile,
    codeDeleteFile,
    codeListDirectory,
    codeApplyPatch,
    codeSearchInFiles,
    codeReplaceInFile,
    codeAstQuery,
    codeLint,
    codeTypecheck,
    codeFindSymbol,
    codeGetFileSummary,
    codeMoveFile,
]