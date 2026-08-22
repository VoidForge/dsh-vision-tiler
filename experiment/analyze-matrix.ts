import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

interface CodexInputRow {
  id: string;
  startedAt: string;
  endedAt: string;
  text: string;
}

interface CodexInput {
  model: string;
  round: number;
  platformTokenUsage: null;
  platformTokenNote: string;
  rows: CodexInputRow[];
}

interface DeepSeekRow {
  id: string;
  round: number;
  strategy: 'direct' | 'v1-uniform' | 'v2-adaptive-lite' | 'v2-adaptive';
  imageCount: number;
  recall: number;
  latencyMs: number;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  text: string;
}

interface DeepSeekInput {
  model: string;
  rows: DeepSeekRow[];
}

const DEFAULT_DATA_DIR = 'D:\\CodexData\\dsh-vision-tiler\\DocumentVQA';
const CODEX_MODELS = ['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra'];

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeWords(text: string): Set<string> {
  const normalized = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim();
  return new Set(normalized.split(/\s+/).filter((word) => word.length >= 2));
}

async function groundTruth(path: string): Promise<Set<string>> {
  const text = await readFile(path, 'utf8');
  return normalizeWords(text.split(/\r?\n/).filter(Boolean)
    .map((line) => line.split(',').slice(8).join(',')).join('\n'));
}

function wordMetrics(reference: Set<string>, text: string): { recall: number; precision: number; f1: number } {
  const observed = normalizeWords(text);
  let matched = 0;
  for (const word of reference) if (observed.has(word)) matched += 1;
  const recall = reference.size === 0 ? 1 : matched / reference.size;
  const precision = observed.size === 0 ? 0 : matched / observed.size;
  const f1 = recall + precision === 0 ? 0 : 2 * recall * precision / (recall + precision);
  return { recall, precision, f1 };
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function summarizeRows(rows: Array<{ recall: number; precision: number; f1: number; latencyMs: number; outputCharacters: number }>) {
  return {
    runs: rows.length,
    meanRecall: rows.reduce((sum, row) => sum + row.recall, 0) / rows.length,
    meanPrecision: rows.reduce((sum, row) => sum + row.precision, 0) / rows.length,
    meanF1: rows.reduce((sum, row) => sum + row.f1, 0) / rows.length,
    medianLatencyMs: percentile(rows.map((row) => row.latencyMs), 0.5),
    p95LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.95),
    meanOutputCharacters: rows.reduce((sum, row) => sum + row.outputCharacters, 0) / rows.length,
  };
}

async function main(): Promise<void> {
  const dataDir = resolve(argument('--data-dir') ?? DEFAULT_DATA_DIR);
  const codexDir = resolve(argument('--codex-dir') ?? 'work/codex_runs');
  const resultsDir = join(dataDir, 'results');
  await mkdir(resultsDir, { recursive: true });
  const references = new Map<string, Set<string>>();
  for (const id of ['008', '009', '010', '011']) {
    references.set(id, await groundTruth(join(dataDir, 'images', `${id}.csv`)));
  }

  const codexFiles = (await readdir(codexDir)).filter((name) => name.endsWith('.json'));
  const codexRuns: Array<{ model: string; round: number; id: string; recall: number; precision: number; f1: number; latencyMs: number; outputCharacters: number; text: string }> = [];
  for (const name of codexFiles) {
    const input = JSON.parse(await readFile(join(codexDir, name), 'utf8')) as CodexInput;
    if (!CODEX_MODELS.includes(input.model)) continue;
    for (const row of input.rows) {
      const reference = references.get(row.id);
      if (!reference) throw new Error(`unexpected sample ${row.id} in ${basename(name)}`);
      const latencyMs = Date.parse(row.endedAt) - Date.parse(row.startedAt);
      if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error(`invalid timestamps in ${basename(name)}:${row.id}`);
      const metrics = wordMetrics(reference, row.text);
      codexRuns.push({
        model: input.model,
        round: input.round,
        id: row.id,
        ...metrics,
        latencyMs,
        outputCharacters: row.text.length,
        text: row.text,
      });
    }
  }

  const deepSeek = JSON.parse(await readFile(join(resultsDir, 'deepseek-matrix-v2.json'), 'utf8')) as DeepSeekInput;
  const deepSeekCost = (rows: DeepSeekRow[]) => {
    const cacheHit = rows.reduce((sum, row) => sum + (row.usage.prompt_cache_hit_tokens ?? 0), 0);
    const cacheMiss = rows.reduce((sum, row) => sum + (row.usage.prompt_cache_miss_tokens ?? row.usage.prompt_tokens ?? 0), 0);
    const output = rows.reduce((sum, row) => sum + (row.usage.completion_tokens ?? 0), 0);
    return {
      pricingPeriod: 'DeepSeek-V4-Flash published rate verified 2026-08-23',
      currency: 'CNY',
      cacheHitInputPerMillion: 0.02,
      cacheMissInputPerMillion: 1,
      outputPerMillion: 2,
      pricingCaveat: 'Estimated using the published DeepSeek-V4-Flash rate; the experimental vision model is not separately listed.',
      total: cacheHit * 0.02 / 1_000_000 + cacheMiss * 1 / 1_000_000 + output * 2 / 1_000_000,
      coldCacheTotal: (cacheHit + cacheMiss) * 1 / 1_000_000 + output * 2 / 1_000_000,
    };
  };

  const arms = [
    ...CODEX_MODELS.map((model) => {
      const rows = codexRuns.filter((row) => row.model === model);
      return {
        arm: model,
        provider: 'Codex subscription',
        ...summarizeRows(rows),
        promptTokens: null,
        completionTokens: null,
        priceCny: null,
        observabilityNote: 'Codex agent surface does not expose billed input/image tokens or per-task currency cost.',
      };
    }),
    ...(['direct', 'v2-adaptive-lite'] as const).map((strategy) => {
      const rows = deepSeek.rows.filter((row) => row.strategy === strategy);
      const cost = deepSeekCost(rows);
      return {
        arm: strategy === 'direct' ? 'deepseek-no-plugin' : 'deepseek-v2-plugin',
        provider: deepSeek.model,
        ...summarizeRows(rows.map((row) => {
          const reference = references.get(row.id);
          if (!reference) throw new Error(`unexpected DeepSeek sample ${row.id}`);
          return { ...wordMetrics(reference, row.text), latencyMs: row.latencyMs, outputCharacters: row.text.length };
        })),
        promptTokens: rows.reduce((sum, row) => sum + (row.usage.prompt_tokens ?? 0), 0),
        completionTokens: rows.reduce((sum, row) => sum + (row.usage.completion_tokens ?? 0), 0),
        meanImages: rows.reduce((sum, row) => sum + row.imageCount, 0) / rows.length,
        priceCny: cost.total,
        priceCnyPerRun: cost.total / rows.length,
        coldCachePriceCny: cost.coldCacheTotal,
        coldCachePriceCnyPerRun: cost.coldCacheTotal / rows.length,
        pricing: cost,
      };
    }),
  ];

  const v1Rows = deepSeek.rows.filter((row) => row.strategy === 'v1-uniform');
  const v2FullRows = deepSeek.rows.filter((row) => row.strategy === 'v2-adaptive');
  const summarizeAblation = (arm: string, selected: DeepSeekRow[]) => ({
    arm,
    ...summarizeRows(selected.map((row) => {
      const reference = references.get(row.id);
      if (!reference) throw new Error(`unexpected DeepSeek sample ${row.id}`);
      return { ...wordMetrics(reference, row.text), latencyMs: row.latencyMs, outputCharacters: row.text.length };
    })),
    promptTokens: selected.reduce((sum, row) => sum + (row.usage.prompt_tokens ?? 0), 0),
    completionTokens: selected.reduce((sum, row) => sum + (row.usage.completion_tokens ?? 0), 0),
    meanImages: selected.reduce((sum, row) => sum + row.imageCount, 0) / selected.length,
    pricing: deepSeekCost(selected),
  });
  const output = {
    generatedAt: new Date().toISOString(),
    design: {
      samples: ['008', '009', '010', '011'],
      rounds: 3,
      codexReasoningEffort: 'medium',
      deepSeekRunOrderSeed: 20260823,
      metric: 'macro mean per-run unique-word recall against SROIE OCR labels',
    },
    arms,
    ablations: [
      summarizeAblation('deepseek-v1-uniform', v1Rows),
      summarizeAblation('deepseek-v2-adaptive-two-details', v2FullRows),
    ],
    codexRuns,
    deepSeekRuns: deepSeek.rows,
  };
  await writeFile(join(resultsDir, 'five-model-matrix.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify({ arms, ablations: output.ablations }, null, 2));
}

await main();
