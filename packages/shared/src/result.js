// Unwrap or throw — use only at the top level CLI boundary
export function unwrap(result) {
    if (result.ok)
        return result.value;
    throw new Error(`[${result.error.code}] ${result.error.message}`);
}
// Chain results without nested ifs
export function andThen(result, fn) {
    if (!result.ok)
        return result;
    return fn(result.value);
}
// Transform the value if ok
export function map(result, fn) {
    if (!result.ok)
        return result;
    return { ok: true, value: fn(result.value) };
}
// Collect multiple results — fails fast on first error
export function collect(results) {
    const values = [];
    for (const r of results) {
        if (!r.ok)
            return r;
        values.push(r.value);
    }
    return { ok: true, value: values };
}
//# sourceMappingURL=result.js.map