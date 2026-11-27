/** Model id prefixes the image tiler is offered for by default. */
export declare const DEFAULT_MODEL_PREFIXES: readonly string[];
/**
 * Whether a model id matches one of the configured prefixes.
 *
 * Matching is case-insensitive and prefix-based so versioned third-party ids such as
 * `deepseek-v4.1-flash-1017` match the `deepseek-v4.1` entry. As of 2026-11-27 the first-party
 * `deepseek-flash` and third-party ids such as `deepseek-v4.1-flash-1017` name the same
 * checkpoint, so both entries cover it. A later checkpoint with a different id needs its own
 * entry. The `deepseek-v4` line (`deepseek-v4-flash`, `deepseek-v4-pro`) is a different model
 * and is deliberately not covered. A provider-qualified id such as
 * `openrouter/deepseek/deepseek-v4.1-flash-1017` also matches on its final path segment.
 * The single entry `*` matches every model.
 * @param prefixes - configured prefixes; an empty list matches nothing.
 * @param model - provider-owned model id from the current model selection.
 */
export declare function modelMatches(prefixes: readonly string[], model: string): boolean;
//# sourceMappingURL=models.d.ts.map