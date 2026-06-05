import { z } from "zod";
export const ok = (value) => ({ ok: true, value });
export const err = (error) => ({ ok: false, error });
// Verifier result schema
export const VerifierVerdictSchema = z.object({
    verdict: z.enum(["approve", "reject", "needs_clarification"]),
    reasoning: z.string(),
    issues: z.array(z.string()),
    suggestion: z.string().optional(),
    confidence: z.number().min(0).max(1),
});
//# sourceMappingURL=types.js.map