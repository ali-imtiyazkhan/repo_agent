import { BaseSubagent } from "./base.js";
export class ReviewerSubagent extends BaseSubagent {
    get systemPrompt() {
        return `You are a senior code reviewer subagent. Your goal is to review code changes (provided as a git diff) and analyze the files involved using your tools.
Look for bugs, security issues, performance problems, code style violations, or type errors.

You MUST respond with ONLY a valid JSON object matching the following structure when you finish:
{
  "approved": boolean,
  "comments": [
    {
      "file": "string (relative path)",
      "line": number,
      "comment": "string",
      "severity": "info" | "warning" | "error"
    }
  ],
  "summary": "string"
}`;
    }
    get allowedTools() {
        return [
            "code.readFile",
            "code.searchInFiles",
            "code.getFileSummary",
            "code.findSymbol",
            "git.diff",
            "git.blame",
        ];
    }
    parseOutput(text) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("No JSON object found in subagent response");
        }
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.approved !== "boolean" || !Array.isArray(parsed.comments) || typeof parsed.summary !== "string") {
            throw new Error("Invalid review output structure");
        }
        return parsed;
    }
}
//# sourceMappingURL=reviewer.js.map