#!/usr/bin/env node
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../../../.env") })

import { EvalHarness, FIXTURES } from "./index.js"

const args = process.argv.slice(2)
const fixtureFlag = args.indexOf("--fixture")
const fixtureId = fixtureFlag !== -1 ? args[fixtureFlag + 1] : undefined

async function main() {
  // Check that Gemini API key is set
  if (!process.env.GEMINI_API_KEY) {
    console.error("[eval] GEMINI_API_KEY is not set. Set it in .env or as an environment variable.")
    process.exit(1)
  }

  const outputDir = path.resolve(__dirname, "../eval-results")
  const runner = new EvalHarness({ outputDir })

  if (fixtureId) {
    const fixture = FIXTURES.find((f) => f.id === fixtureId)
    if (!fixture) {
      console.error(`Unknown fixture: ${fixtureId}`)
      console.error(`Available: ${FIXTURES.map((f) => f.id).join(", ")}`)
      process.exit(1)
    }
    const result = await runner.runFixture(fixture)
    process.exit(result.passed ? 0 : 1)
  } else {
    const results = await runner.runAll()
    const allPassed = results.every((r) => r.passed)
    process.exit(allPassed ? 0 : 1)
  }
}

main().catch((e) => {
  console.error("[eval fatal]", e)
  process.exit(1)
})