import { z } from "zod"
import { Octokit } from "@octokit/rest"
import type { Tool } from "../../../shared/src"
import { ok, err } from "../../../shared/src"

// Octokit factory 

function gh(token: string): Octokit {
  return new Octokit({ auth: token })
}

// Shared base input 

const baseInput = {
  token: z.string().describe("GitHub personal access token"),
  owner: z.string().describe("Repository owner (user or org)"),
  repo: z.string().describe("Repository name"),
}

// github.getPR 

export const githubGetPR: Tool<
  { token: string; owner: string; repo: string; prNumber: number },
  {
    number: number
    title: string
    body: string
    state: string
    draft: boolean
    author: string
    base: string
    head: string
    mergeable: boolean | null
    additions: number
    deletions: number
    changedFiles: number
    labels: string[]
    reviewers: string[]
    url: string
  }
> = {
  namespace: "github",
  name: "getPR",
  description: "Get details of a pull request including diff stats and reviewers",
  inputSchema: z.object({
    ...baseInput,
    prNumber: z.number().describe("Pull request number"),
  }),
  outputSchema: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string(),
    state: z.string(),
    draft: z.boolean(),
    author: z.string(),
    base: z.string(),
    head: z.string(),
    mergeable: z.boolean().nullable(),
    additions: z.number(),
    deletions: z.number(),
    changedFiles: z.number(),
    labels: z.array(z.string()),
    reviewers: z.array(z.string()),
    url: z.string(),
  }),
  async execute({ token, owner, repo, prNumber }) {
    try {
      const { data } = await gh(token).pulls.get({ owner, repo, pull_number: prNumber })
      return ok({
        number: data.number,
        title: data.title,
        body: data.body ?? "",
        state: data.state,
        draft: data.draft ?? false,
        author: data.user?.login ?? "",
        base: data.base.ref,
        head: data.head.ref,
        mergeable: data.mergeable ?? null,
        additions: data.additions,
        deletions: data.deletions,
        changedFiles: data.changed_files,
        labels: data.labels.map((l) => l.name),
        reviewers: data.requested_reviewers?.map((r) => r.login) ?? [],
        url: data.html_url,
      })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.getPR",
        retryable: true,
        cause: e,
      })
    }
  },
}

// github.listPRs 

export const githubListPRs: Tool<
  {
    token: string
    owner: string
    repo: string
    state?: "open" | "closed" | "all"
    limit?: number
  },
  {
    prs: Array<{
      number: number
      title: string
      state: string
      author: string
      draft: boolean
      createdAt: string
      url: string
    }>
  }
> = {
  namespace: "github",
  name: "listPRs",
  description: "List pull requests for a repository",
  inputSchema: z.object({
    ...baseInput,
    state: z.enum(["open", "closed", "all"]).optional().describe("Filter by state"),
    limit: z.number().optional().describe("Max PRs to return, default 20"),
  }),
  outputSchema: z.object({
    prs: z.array(
      z.object({
        number: z.number(),
        title: z.string(),
        state: z.string(),
        author: z.string(),
        draft: z.boolean(),
        createdAt: z.string(),
        url: z.string(),
      })
    ),
  }),
  async execute({ token, owner, repo, state = "open", limit = 20 }) {
    try {
      const { data } = await gh(token).pulls.list({
        owner,
        repo,
        state,
        per_page: Math.min(limit, 100),
      })
      return ok({
        prs: data.map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          author: pr.user?.login ?? "",
          draft: pr.draft ?? false,
          createdAt: pr.created_at,
          url: pr.html_url,
        })),
      })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.listPRs",
        retryable: true,
        cause: e,
      })
    }
  },
}

// github.createPR 

export const githubCreatePR: Tool<
  {
    token: string
    owner: string
    repo: string
    title: string
    body: string
    head: string
    base: string
    draft?: boolean
  },
  { number: number; url: string }
> = {
  namespace: "github",
  name: "createPR",
  description: "Create a new pull request",
  inputSchema: z.object({
    ...baseInput,
    title: z.string(),
    body: z.string().describe("PR description in markdown"),
    head: z.string().describe("Branch with changes"),
    base: z.string().describe("Branch to merge into"),
    draft: z.boolean().optional(),
  }),
  outputSchema: z.object({ number: z.number(), url: z.string() }),
  async execute({ token, owner, repo, title, body, head, base, draft = false }) {
    try {
      const { data } = await gh(token).pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
        draft,
      })
      return ok({ number: data.number, url: data.html_url })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.createPR",
        retryable: false,
        cause: e,
      })
    }
  },
}

// github.mergePR 

export const githubMergePR: Tool<
  {
    token: string
    owner: string
    repo: string
    prNumber: number
    method?: "merge" | "squash" | "rebase"
    commitTitle?: string
  },
  { merged: boolean; sha: string; message: string }
> = {
  namespace: "github",
  name: "mergePR",
  description: "Merge a pull request",
  inputSchema: z.object({
    ...baseInput,
    prNumber: z.number(),
    method: z.enum(["merge", "squash", "rebase"]).optional(),
    commitTitle: z.string().optional(),
  }),
  outputSchema: z.object({
    merged: z.boolean(),
    sha: z.string(),
    message: z.string(),
  }),
  async execute({ token, owner, repo, prNumber, method = "squash", commitTitle }) {
    try {
      const { data } = await gh(token).pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: method,
        ...(commitTitle ? { commit_title: commitTitle } : {}),
      })
      return ok({ merged: data.merged, sha: data.sha ?? "", message: data.message })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.mergePR",
        retryable: false,
        cause: e,
      })
    }
  },
}

// github.reviewPR 

export const githubReviewPR: Tool<
  {
    token: string
    owner: string
    repo: string
    prNumber: number
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
    body: string
  },
  { reviewId: number; state: string }
> = {
  namespace: "github",
  name: "reviewPR",
  description: "Submit a review on a pull request",
  inputSchema: z.object({
    ...baseInput,
    prNumber: z.number(),
    event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
    body: z.string().describe("Review comment body"),
  }),
  outputSchema: z.object({ reviewId: z.number(), state: z.string() }),
  async execute({ token, owner, repo, prNumber, event, body }) {
    try {
      const { data } = await gh(token).pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event,
        body,
      })
      return ok({ reviewId: data.id, state: data.state })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.reviewPR",
        retryable: false,
        cause: e,
      })
    }
  },
}

// github.getPRDiff 

export const githubGetPRDiff: Tool<
  { token: string; owner: string; repo: string; prNumber: number },
  { diff: string; files: Array<{ filename: string; status: string; additions: number; deletions: number }> }
> = {
  namespace: "github",
  name: "getPRDiff",
  description: "Get the full diff and changed files list for a pull request",
  inputSchema: z.object({ ...baseInput, prNumber: z.number() }),
  outputSchema: z.object({
    diff: z.string(),
    files: z.array(
      z.object({
        filename: z.string(),
        status: z.string(),
        additions: z.number(),
        deletions: z.number(),
      })
    ),
  }),
  async execute({ token, owner, repo, prNumber }) {
    try {
      const client = gh(token)
      const { data: filesData } = await client.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      })
      const diffParts = filesData.map((f) => f.patch ?? "").join("\n")
      return ok({
        diff: diffParts,
        files: filesData.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
        })),
      })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.getPRDiff",
        retryable: true,
        cause: e,
      })
    }
  },
}

// ─── github.createIssue ───────────────────────────────────────────────────────

export const githubCreateIssue: Tool<
  {
    token: string
    owner: string
    repo: string
    title: string
    body: string
    labels?: string[]
    assignees?: string[]
  },
  { number: number; url: string }
> = {
  namespace: "github",
  name: "createIssue",
  description: "Create a new GitHub issue",
  inputSchema: z.object({
    ...baseInput,
    title: z.string(),
    body: z.string(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({ number: z.number(), url: z.string() }),
  async execute({ token, owner, repo, title, body, labels, assignees }) {
    try {
      const { data } = await gh(token).issues.create({
        owner,
        repo,
        title,
        body,
        labels,
        assignees,
      })
      return ok({ number: data.number, url: data.html_url })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.createIssue",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── github.listIssues ────────────────────────────────────────────────────────

export const githubListIssues: Tool<
  {
    token: string
    owner: string
    repo: string
    state?: "open" | "closed" | "all"
    labels?: string[]
    limit?: number
  },
  {
    issues: Array<{
      number: number
      title: string
      state: string
      author: string
      labels: string[]
      createdAt: string
      url: string
    }>
  }
> = {
  namespace: "github",
  name: "listIssues",
  description: "List issues for a repository",
  inputSchema: z.object({
    ...baseInput,
    state: z.enum(["open", "closed", "all"]).optional(),
    labels: z.array(z.string()).optional(),
    limit: z.number().optional(),
  }),
  outputSchema: z.object({
    issues: z.array(
      z.object({
        number: z.number(),
        title: z.string(),
        state: z.string(),
        author: z.string(),
        labels: z.array(z.string()),
        createdAt: z.string(),
        url: z.string(),
      })
    ),
  }),
  async execute({ token, owner, repo, state = "open", labels, limit = 20 }) {
    try {
      const { data } = await gh(token).issues.listForRepo({
        owner,
        repo,
        state,
        labels: labels?.join(","),
        per_page: Math.min(limit, 100),
      })
      // Filter out pull requests (GitHub API returns PRs as issues too)
      const issues = data.filter((i) => !i.pull_request)
      return ok({
        issues: issues.map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          author: i.user?.login ?? "",
          labels: i.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
          createdAt: i.created_at,
          url: i.html_url,
        })),
      })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.listIssues",
        retryable: true,
        cause: e,
      })
    }
  },
}

// ─── github.commentOnIssue ────────────────────────────────────────────────────

export const githubCommentOnIssue: Tool<
  { token: string; owner: string; repo: string; issueNumber: number; body: string },
  { commentId: number; url: string }
> = {
  namespace: "github",
  name: "commentOnIssue",
  description: "Post a comment on an issue or pull request",
  inputSchema: z.object({
    ...baseInput,
    issueNumber: z.number(),
    body: z.string().describe("Comment body in markdown"),
  }),
  outputSchema: z.object({ commentId: z.number(), url: z.string() }),
  async execute({ token, owner, repo, issueNumber, body }) {
    try {
      const { data } = await gh(token).issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      })
      return ok({ commentId: data.id, url: data.html_url })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.commentOnIssue",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── github.closeIssue ────────────────────────────────────────────────────────

export const githubCloseIssue: Tool<
  { token: string; owner: string; repo: string; issueNumber: number; reason?: "completed" | "not_planned" },
  { closed: boolean; number: number }
> = {
  namespace: "github",
  name: "closeIssue",
  description: "Close a GitHub issue",
  inputSchema: z.object({
    ...baseInput,
    issueNumber: z.number(),
    reason: z.enum(["completed", "not_planned"]).optional(),
  }),
  outputSchema: z.object({ closed: z.boolean(), number: z.number() }),
  async execute({ token, owner, repo, issueNumber, reason = "completed" }) {
    try {
      const { data } = await gh(token).issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        state: "closed",
        state_reason: reason,
      })
      return ok({ closed: data.state === "closed", number: data.number })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.closeIssue",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── github.addLabels ─────────────────────────────────────────────────────────

export const githubAddLabels: Tool<
  { token: string; owner: string; repo: string; issueNumber: number; labels: string[] },
  { labels: string[] }
> = {
  namespace: "github",
  name: "addLabels",
  description: "Add labels to an issue or pull request",
  inputSchema: z.object({
    ...baseInput,
    issueNumber: z.number(),
    labels: z.array(z.string()),
  }),
  outputSchema: z.object({ labels: z.array(z.string()) }),
  async execute({ token, owner, repo, issueNumber, labels }) {
    try {
      const { data } = await gh(token).issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels,
      })
      return ok({ labels: data.map((l) => l.name) })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.addLabels",
        retryable: false,
        cause: e,
      })
    }
  },
}

// ─── github.getActionsStatus ──────────────────────────────────────────────────

export const githubGetActionsStatus: Tool<
  { token: string; owner: string; repo: string; branch?: string; limit?: number },
  {
    runs: Array<{
      id: number
      name: string
      status: string
      conclusion: string | null
      branch: string
      createdAt: string
      url: string
    }>
  }
> = {
  namespace: "github",
  name: "getActionsStatus",
  description: "Get recent GitHub Actions workflow run statuses",
  inputSchema: z.object({
    ...baseInput,
    branch: z.string().optional(),
    limit: z.number().optional(),
  }),
  outputSchema: z.object({
    runs: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        status: z.string(),
        conclusion: z.string().nullable(),
        branch: z.string(),
        createdAt: z.string(),
        url: z.string(),
      })
    ),
  }),
  async execute({ token, owner, repo, branch, limit = 10 }) {
    try {
      const { data } = await gh(token).actions.listWorkflowRunsForRepo({
        owner,
        repo,
        branch,
        per_page: Math.min(limit, 100),
      })
      return ok({
        runs: data.workflow_runs.map((r) => ({
          id: r.id,
          name: r.name ?? "",
          status: r.status ?? "",
          conclusion: r.conclusion ?? null,
          branch: r.head_branch ?? "",
          createdAt: r.created_at,
          url: r.html_url,
        })),
      })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.getActionsStatus",
        retryable: true,
        cause: e,
      })
    }
  },
}

// github.triggerWorkflow 

export const githubTriggerWorkflow: Tool<
  {
    token: string
    owner: string
    repo: string
    workflowId: string
    ref: string
    inputs?: Record<string, string>
  },
  { triggered: boolean }
> = {
  namespace: "github",
  name: "triggerWorkflow",
  description: "Manually trigger a GitHub Actions workflow",
  inputSchema: z.object({
    ...baseInput,
    workflowId: z.string().describe("Workflow file name e.g. ci.yml"),
    ref: z.string().describe("Branch or tag to run on"),
    inputs: z.record(z.string()).optional().describe("Workflow input parameters"),
  }),
  outputSchema: z.object({ triggered: z.boolean() }),
  async execute({ token, owner, repo, workflowId, ref, inputs }) {
    try {
      await gh(token).actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: workflowId,
        ref,
        inputs,
      })
      return ok({ triggered: true })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.triggerWorkflow",
        retryable: false,
        cause: e,
      })
    }
  },
}

// github.createRelease 

export const githubCreateRelease: Tool<
  {
    token: string
    owner: string
    repo: string
    tag: string
    name: string
    body: string
    draft?: boolean
    prerelease?: boolean
  },
  { id: number; url: string; tag: string }
> = {
  namespace: "github",
  name: "createRelease",
  description: "Create a GitHub release",
  inputSchema: z.object({
    ...baseInput,
    tag: z.string().describe("Tag name for the release"),
    name: z.string().describe("Release title"),
    body: z.string().describe("Release notes in markdown"),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
  }),
  outputSchema: z.object({ id: z.number(), url: z.string(), tag: z.string() }),
  async execute({ token, owner, repo, tag, name, body, draft = false, prerelease = false }) {
    try {
      const { data } = await gh(token).repos.createRelease({
        owner,
        repo,
        tag_name: tag,
        name,
        body,
        draft,
        prerelease,
      })
      return ok({ id: data.id, url: data.html_url, tag: data.tag_name })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.createRelease",
        retryable: false,
        cause: e,
      })
    }
  },
}

// github.getRepoInfo 

export const githubGetRepoInfo: Tool<
  { token: string; owner: string; repo: string },
  {
    fullName: string
    description: string
    defaultBranch: string
    language: string | null
    stars: number
    forks: number
    openIssues: number
    topics: string[]
    url: string
  }
> = {
  namespace: "github",
  name: "getRepoInfo",
  description: "Get metadata about a GitHub repository",
  inputSchema: z.object({ ...baseInput }),
  outputSchema: z.object({
    fullName: z.string(),
    description: z.string(),
    defaultBranch: z.string(),
    language: z.string().nullable(),
    stars: z.number(),
    forks: z.number(),
    openIssues: z.number(),
    topics: z.array(z.string()),
    url: z.string(),
  }),
  async execute({ token, owner, repo }) {
    try {
      const { data } = await gh(token).repos.get({ owner, repo })
      return ok({
        fullName: data.full_name,
        description: data.description ?? "",
        defaultBranch: data.default_branch,
        language: data.language ?? null,
        stars: data.stargazers_count,
        forks: data.forks_count,
        openIssues: data.open_issues_count,
        topics: data.topics ?? [],
        url: data.html_url,
      })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.getRepoInfo",
        retryable: true,
        cause: e,
      })
    }
  },
}

// github.addPRReviewComment 

export const githubAddPRReviewComment: Tool<
  {
    token: string
    owner: string
    repo: string
    prNumber: number
    body: string
    path: string
    line: number
    commitSha: string
  },
  { commentId: number; url: string }
> = {
  namespace: "github",
  name: "addPRReviewComment",
  description: "Add an inline review comment on a specific line in a PR diff",
  inputSchema: z.object({
    ...baseInput,
    prNumber: z.number(),
    body: z.string().describe("Comment text"),
    path: z.string().describe("File path to comment on"),
    line: z.number().describe("Line number in the diff"),
    commitSha: z.string().describe("SHA of the commit to comment on"),
  }),
  outputSchema: z.object({ commentId: z.number(), url: z.string() }),
  async execute({ token, owner, repo, prNumber, body, path, line, commitSha }) {
    try {
      const { data } = await gh(token).pulls.createReviewComment({
        owner,
        repo,
        pull_number: prNumber,
        body,
        path,
        line,
        commit_id: commitSha,
      })
      return ok({ commentId: data.id, url: data.html_url })
    } catch (e) {
      return err({
        code: "GITHUB_API_ERROR",
        message: (e as Error).message,
        toolName: "github.addPRReviewComment",
        retryable: false,
        cause: e,
      })
    }
  },
}

// Exports 

export const githubTools = [
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
]