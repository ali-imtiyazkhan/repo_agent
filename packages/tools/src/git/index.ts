import { z } from "zod"
import { simpleGit } from "simple-git"
import type { Tool } from "../../../shared/src"
import { ok, err } from "../../../shared/src"

const git = (cwd: string) => simpleGit({ baseDir: cwd, binary: "git" })

// ─── git.clone ────────────────────────────────────────────────────────────────

export const gitClone: Tool<
  { url: string; destination: string; branch?: string },
  { path: string; defaultBranch: string }
> = {
  namespace: "git",
  name: "clone",
  description: "Clone a git repository to a local path",
  inputSchema: z.object({
    url: z.string().describe("Repository URL to clone"),
    destination: z.string().describe("Local path to clone into"),
    branch: z.string().optional().describe("Branch to checkout after clone"),
  }),
  outputSchema: z.object({
    path: z.string(),
    defaultBranch: z.string(),
  }),
  
  async execute({ url, destination, branch }) {
    try {
      const g = simpleGit()
      await g.clone(url, destination, branch ? ["-b", branch] : [])
      const cloned = git(destination)
      const status = await cloned.status()
      return ok({ path: destination, defaultBranch: status.current ?? "main" })
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: `Clone failed: ${(e as Error).message}`,
        toolName: "git.clone",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── git.status ───────────────────────────────────────────────────────────────

export const gitStatus: Tool<
  { cwd: string },
  {
    branch: string
    modified: string[]
    untracked: string[]
    staged: string[]
    ahead: number
    behind: number
  }
> = {
  namespace: "git",
  name: "status",
  description: "Get the current git status of a repository",
  inputSchema: z.object({ cwd: z.string() }),
  outputSchema: z.object({
    branch: z.string(),
    modified: z.array(z.string()),
    untracked: z.array(z.string()),
    staged: z.array(z.string()),
    ahead: z.number(),
    behind: z.number(),
  }),
  
  async execute({ cwd }) {
    try {
      const status = await git(cwd).status()
      return ok({
        branch: status.current ?? "unknown",
        modified: status.modified,
        untracked: status.not_added,
        staged: status.staged,
        ahead: status.ahead,
        behind: status.behind,
      })
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: (e as Error).message,
        toolName: "git.status",
        retryable: true,
        cause: e,
      })
    }
  },
}

// ─── git.diff ─────────────────────────────────────────────────────────────────

export const gitDiff: Tool<
  { cwd: string; base?: string; head?: string; file?: string },
  { diff: string; filesChanged: number; insertions: number; deletions: number }
> = {
  namespace: "git",
  name: "diff",
  description: "Get a git diff between commits, branches, or working tree",
  inputSchema: z.object({
    cwd: z.string(),
    base: z.string().optional().describe("Base ref (commit/branch)"),
    head: z.string().optional().describe("Head ref, defaults to working tree"),
    file: z.string().optional().describe("Limit diff to a specific file"),
  }),
  outputSchema: z.object({
    diff: z.string(),
    filesChanged: z.number(),
    insertions: z.number(),
    deletions: z.number(),
  }),
  async execute({ cwd, base, head, file }) {
    try {
      const g = git(cwd)
      const args = [base, head].filter(Boolean) as string[]
      if (file) args.push("--", file)
      const diff = await g.diff(args)
      const stat = await g.diffSummary(args)
      return ok({
        diff,
        filesChanged: stat.files.length,
        insertions: stat.insertions,
        deletions: stat.deletions,
      })
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: (e as Error).message,
        toolName: "git.diff",
        retryable: true,
        cause: e,
      })
    }
  },
}

// ─── git.log ──────────────────────────────────────────────────────────────────

export const gitLog: Tool<
  { cwd: string; limit?: number; branch?: string },
  {
    commits: Array<{
      hash: string
      message: string
      author: string
      date: string
    }>
  }
> = {
  namespace: "git",
  name: "log",
  description: "Get the git commit log",
  inputSchema: z.object({
    cwd: z.string(),
    limit: z.number().optional().describe("Max commits to return, default 20"),
    branch: z.string().optional(),
  }),
  outputSchema: z.object({
    commits: z.array(
      z.object({
        hash: z.string(),
        message: z.string(),
        author: z.string(),
        date: z.string(),
      })
    ),
  }),
  async execute({ cwd, limit = 20, branch }) {
    try {
      const log = await git(cwd).log({
        maxCount: limit,
        ...(branch ? { from: branch } : {}),
      })
      return ok({
        commits: log.all.map((c) => ({
          hash: c.hash,
          message: c.message,
          author: c.author_name,
          date: c.date,
        })),
      })
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: (e as Error).message,
        toolName: "git.log",
        retryable: true,
        cause: e,
      })
    }
  },
}

// ─── git.commit ───────────────────────────────────────────────────────────────

export const gitCommit: Tool<
  { cwd: string; message: string; files?: string[] },
  { hash: string; branch: string }
> = {
  namespace: "git",
  name: "commit",
  description: "Stage files and create a git commit",
  inputSchema: z.object({
    cwd: z.string(),
    message: z.string().describe("Commit message"),
    files: z
      .array(z.string())
      .optional()
      .describe("Files to stage, defaults to all"),
  }),
  outputSchema: z.object({ hash: z.string(), branch: z.string() }),
  async execute({ cwd, message, files }) {
    try {
      const g = git(cwd)
      await g.add(files ?? ["."])
      const result = await g.commit(message)
      return ok({ hash: result.commit, branch: result.branch })
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: (e as Error).message,
        toolName: "git.commit",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── git.branch ───────────────────────────────────────────────────────────────

export const gitBranch: Tool<
  { cwd: string; name: string; checkout?: boolean },
  { created: string; current: string }
> = {
  namespace: "git",
  name: "branch",
  description: "Create a new git branch, optionally checking it out",
  inputSchema: z.object({
    cwd: z.string(),
    name: z.string().describe("Branch name to create"),
    checkout: z
      .boolean()
      .optional()
      .describe("Switch to new branch after creating"),
  }),
  outputSchema: z.object({ created: z.string(), current: z.string() }),
  async execute({ cwd, name, checkout = true }) {
    try {
      const g = git(cwd)
      await g.checkoutLocalBranch(name)
      if (!checkout) await g.checkout("-")
      const status = await g.status()
      return ok({ created: name, current: status.current ?? name })
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: (e as Error).message,
        toolName: "git.branch",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── git.blame ────────────────────────────────────────────────────────────────

export const gitBlame: Tool<
  { cwd: string; file: string; startLine?: number; endLine?: number },
  {
    lines: Array<{
      line: number
      hash: string
      author: string
      content: string
    }>
  }
> = {
  namespace: "git",
  name: "blame",
  description: "Show who last modified each line of a file",
  inputSchema: z.object({
    cwd: z.string(),
    file: z.string(),
    startLine: z.number().optional(),
    endLine: z.number().optional(),
  }),
  outputSchema: z.object({
    lines: z.array(
      z.object({
        line: z.number(),
        hash: z.string(),
        author: z.string(),
        content: z.string(),
      })
    ),
  }),
  async execute({ cwd, file, startLine, endLine }) {
    try {
      const args = ["blame", "--porcelain"]
      if (startLine && endLine) args.push(`-L ${startLine},${endLine}`)
      args.push(file)
      const raw = await git(cwd).raw(args)
      const lines = parseBlameOutput(raw)
      return ok({ lines })
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: (e as Error).message,
        toolName: "git.blame",
        retryable: true,
        cause: e,
      })
    }
  },
}

function parseBlameOutput(
  raw: string
): Array<{ line: number; hash: string; author: string; content: string }> {
  const lines: Array<{
    line: number
    hash: string
    author: string
    content: string
  }> = []
  const rawLines = raw.split("\n")
  let lineNum = 0
  let currentHash = ""
  let currentAuthor = ""

  for (const line of rawLines) {
    if (/^[0-9a-f]{40}/.test(line)) {
      currentHash = line.slice(0, 40)
      lineNum++
    } else if (line.startsWith("author ")) {
      currentAuthor = line.slice(7)
    } else if (line.startsWith("\t")) {
      lines.push({
        line: lineNum,
        hash: currentHash,
        author: currentAuthor,
        content: line.slice(1),
      })
    }
  }
  return lines
}

// ─── git.stash ────────────────────────────────────────────────────────────────

export const gitStash: Tool<
  { cwd: string; action: "push" | "pop" | "list"; message?: string },
  { success: boolean; stashes?: string[] }
> = {
  namespace: "git",
  name: "stash",
  description: "Push, pop, or list git stashes",
  inputSchema: z.object({
    cwd: z.string(),
    action: z.enum(["push", "pop", "list"]),
    message: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    stashes: z.array(z.string()).optional(),
  }),
  async execute({ cwd, action, message }) {
    try {
      const g = git(cwd)
      if (action === "push") {
        await g.stash(message ? ["push", "-m", message] : ["push"])
        return ok({ success: true })
      } else if (action === "pop") {
        await g.stash(["pop"])
        return ok({ success: true })
      } else {
        const list = await g.stashList()
        return ok({
          success: true,
          stashes: list.all.map((s) => s.message),
        })
      }
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: (e as Error).message,
        toolName: "git.stash",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── git.checkout ─────────────────────────────────────────────────────────────

export const gitCheckout: Tool<
  { cwd: string; ref: string },
  { current: string }
> = {
  namespace: "git",
  name: "checkout",
  description: "Checkout a branch or commit",
  inputSchema: z.object({ cwd: z.string(), ref: z.string() }),
  outputSchema: z.object({ current: z.string() }),
  async execute({ cwd, ref }) {
    try {
      await git(cwd).checkout(ref)
      const status = await git(cwd).status()
      return ok({ current: status.current ?? ref })
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: (e as Error).message,
        toolName: "git.checkout",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── git.merge ────────────────────────────────────────────────────────────────

export const gitMerge: Tool<
  { cwd: string; branch: string; noFf?: boolean },
  { success: boolean; conflicts: string[] }
> = {
  namespace: "git",
  name: "merge",
  description: "Merge a branch into the current branch",
  inputSchema: z.object({
    cwd: z.string(),
    branch: z.string().describe("Branch to merge in"),
    noFf: z.boolean().optional().describe("Force a merge commit"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    conflicts: z.array(z.string()),
  }),
  async execute({ cwd, branch, noFf = false }) {
    try {
      const g = git(cwd)
      const args = noFf ? ["--no-ff", branch] : [branch]
      await g.merge(args)
      return ok({ success: true, conflicts: [] })
    } catch (e) {
      const msg = (e as Error).message
      const conflicts = msg.includes("CONFLICT")
        ? msg.match(/CONFLICT.*: (.*)/g)?.map((l) => l.split(": ")[1] ?? "") ?? []
        : []
      return err({
        code: "GIT_ERROR",
        message: msg,
        toolName: "git.merge",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── git.push ─────────────────────────────────────────────────────────────────

export const gitPush: Tool<
  { cwd: string; remote?: string; branch?: string; force?: boolean },
  { success: boolean; remote: string; branch: string }
> = {
  namespace: "git",
  name: "push",
  description: "Push commits to a remote repository",
  inputSchema: z.object({
    cwd: z.string(),
    remote: z.string().optional().describe("Remote name, defaults to origin"),
    branch: z.string().optional().describe("Branch to push, defaults to current"),
    force: z.boolean().optional().describe("Force push"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    remote: z.string(),
    branch: z.string(),
  }),
  async execute({ cwd, remote = "origin", branch, force = false }) {
    try {
      const g = git(cwd)
      const status = await g.status()
      const targetBranch = branch ?? status.current ?? "main"
      const args = force ? ["--force"] : []
      await g.push(remote, targetBranch, args)
      return ok({ success: true, remote, branch: targetBranch })
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: (e as Error).message,
        toolName: "git.push",
        retryable: true,
        cause: e,
      })
    }
  },
}

// ─── git.tag ──────────────────────────────────────────────────────────────────

export const gitTag: Tool<
  { cwd: string; name: string; message?: string; ref?: string },
  { tag: string; ref: string }
> = {
  namespace: "git",
  name: "tag",
  description: "Create a git tag",
  inputSchema: z.object({
    cwd: z.string(),
    name: z.string().describe("Tag name"),
    message: z.string().optional().describe("Annotated tag message"),
    ref: z.string().optional().describe("Commit to tag, defaults to HEAD"),
  }),
  outputSchema: z.object({ tag: z.string(), ref: z.string() }),
  async execute({ cwd, name, message, ref }) {
    try {
      const g = git(cwd)
      if (message) {
        await g.tag(["-a", name, "-m", message, ...(ref ? [ref] : [])])
      } else {
        await g.tag([name, ...(ref ? [ref] : [])])
      }
      return ok({ tag: name, ref: ref ?? "HEAD" })
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: (e as Error).message,
        toolName: "git.tag",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const gitTools = [
  gitClone,
  gitStatus,
  gitDiff,
  gitLog,
  gitCommit,
  gitBranch,
  gitBlame,
  gitStash,
  gitCheckout,
  gitMerge,
  gitPush,
  gitTag,
]