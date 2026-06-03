import { ToolRegistry } from "./registry.js"
import { gitTools } from "./git/index.js"
import { githubTools } from "./github/index.js"
import { codeTools } from "./code/index.js"
import { shellTools } from "./shell/index.js"

export { ToolRegistry } from "./registry.js"
export { zodToJsonSchema } from "./registry.js"
export type { AnthropicToolDefinition } from "./registry.js"

// ─── Git namespace exports ────────────────────────────────────────────────────
export {
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
  gitTools,
} from "./git/index.js"

// GitHub namespace exports 
export {
  githubGetPR,
  githubListPRs,
  githubCreatePR,
  githubMergePR,
  githubReviewPR,
  githubGetPRDiff,
  githubCreateIssue,
  githubListIssues,
  githubCommentOnIssue,
  githubCloseIssue,
  githubAddLabels,
  githubGetActionsStatus,
  githubTriggerWorkflow,
  githubCreateRelease,
  githubGetRepoInfo,
  githubAddPRReviewComment,
  githubTools,
} from "./github/index.js"

//  Code namespace exports 
export {
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
  codeTools,
} from "./code/index.js"

//  Shell namespace exports 
export {
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
  shellTools,
} from "./shell/index.js"

//  createRegistry 
// Single factory function — every part of the codebase calls this
// to get a fully-wired registry. Subagents call scoped() on the result.

export function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry()

  registry
    .registerAll(gitTools as any)
    .registerAll(githubTools as any)
    .registerAll(codeTools as any)
    .registerAll(shellTools as any)

  const summary = registry.summary()
  const total = registry.size

  console.log(`[registry] Loaded ${total} tools across ${Object.keys(summary).length} namespaces:`)
  for (const [ns, count] of Object.entries(summary)) {
    console.log(`  ${ns}.*  →  ${count} tools`)
  }

  return registry
}

//  Subagent tool scopes 
// Predefined scoped sets for each subagent type.
// Subagents only see the tools they need — not the full registry.

export const REVIEWER_TOOLS = [
  "code.readFile",
  "code.searchInFiles",
  "code.astQuery",
  "code.getFileSummary",
  "code.findSymbol",
  "git.diff",
  "git.log",
  "git.blame",
]

export const TEST_RUNNER_TOOLS = [
  "shell.runTests",
  "shell.exec",
  "shell.scriptRunner",
  "code.readFile",
  "code.searchInFiles",
]

export const LINTER_TOOLS = [
  "code.lint",
  "code.typecheck",
  "code.readFile",
  "code.getFileSummary",
]

export const VERIFIER_TOOLS = [
  "code.readFile",
  "code.searchInFiles",
  "code.astQuery",
  "code.getFileSummary",
  "shell.runTests",
  "shell.exec",
  "git.diff",
]