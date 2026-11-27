/** Model id prefixes the image tiler is offered for by default. */
export const DEFAULT_MODEL_PREFIXES: readonly string[] = ['deepseek-flash', 'deepseek-v4.1'];

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
export function modelMatches(prefixes: readonly string[], model: string): boolean {
  const id = model.trim().toLowerCase();
  if (id === '') return false;
  const candidates = new Set<string>([id]);
  for (const separator of ['/', ':']) {
    const index = id.lastIndexOf(separator);
    if (index >= 0 && index < id.length - 1) candidates.add(id.slice(index + 1));
  }
  for (const entry of prefixes) {
    const prefix = entry.trim().toLowerCase();
    if (prefix === '*') return true;
    if (prefix === '') continue;
    for (const candidate of candidates) {
      if (candidate.startsWith(prefix)) return true;
    }
  }
  return false;
}
