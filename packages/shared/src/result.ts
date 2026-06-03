import type { Result, AgentError } from "./types.js"

// Unwrap or throw — use only at the top level CLI boundary
export function unwrap<T>(result: Result<T, AgentError>): T {
  if (result.ok) return result.value
  throw new Error(`[${result.error.code}] ${result.error.message}`)
}

// Chain results without nested ifs
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (!result.ok) return result
  return fn(result.value)
}

// Transform the value if ok
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  if (!result.ok) return result
  return { ok: true, value: fn(result.value) }
}

// Collect multiple results — fails fast on first error
export function collect<T, E>(
  results: Result<T, E>[]
): Result<T[], E> {
  const values: T[] = []
  for (const r of results) {
    if (!r.ok) return r
    values.push(r.value)
  }
  return { ok: true, value: values }
}