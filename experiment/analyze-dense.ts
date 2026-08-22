import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface CodexImageRun {
  id: string;
  startedAt: string;
  endedAt: string;
  text: string;
}

interface CodexRun {
  model: string;
  round: number;
  images: CodexImageRun[];
}

interface Score {
  predicted: number;
  matched: number;
  truth: number;
  recall: number;
  precision: number;
  f1: number;
}

const DEFAULT_DATA_DIR = 'D:\\CodexData\\dsh-vision-tiler\\DenseText';
const CODEX_MODELS = ['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra'];
const IDS = ['D01', 'D02', 'D03', 'D04'];

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function extractCodes(text: string): Set<string> {
  return new Set(text.toUpperCase().match(/(?<![A-Z0-9])[A-Z0-9]{8}(?![A-Z0-9])/g) ?? []);
}

function score(truth: Set<string>, text: string): Score {
  const predicted = extractCodes(text);
  let matched = 0;
  for (const code of truth) if (predicted.has(code)) matched += 1;
  const recall = truth.size === 0 ? 1 : matched / truth.size;
  const precision = predicted.size === 0 ? 0 : matched / predicted.size;
  return {
    predicted: predicted.size,
    matched,
    truth: truth.size,
    recall,
    precision,
    f1: recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision),
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

function aggregate(rows: Array<Score & { latencyMs: number }>): Record<string, number> {
  const matched = rows.reduce((sum, row) => sum + row.matched, 0);
  const truth = rows.reduce((sum, row) => sum + row.truth, 0);
  const predicted = rows.reduce((sum, row) => sum + row.predicted, 0);
  const recall = truth === 0 ? 1 : matched / truth;
  const precision = predicted === 0 ? 0 : matched / predicted;
  return {
    runs: rows.length,
    matched,
    truth,
    predicted,
    microRecall: recall,
    microPrecision: precision,
    microF1: recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision),
    medianLatencyMs: percentile(rows.map((row) => row.latencyMs), 0.5),
    p95LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.95),
  };
}

async function main(): Promise<void> {
  const root = resolve(argument('--data-dir') ?? DEFAULT_DATA_DIR);
  const codexDir = resolve(argument('--codex-dir') ?? 'work/codex_dense_runs');
  const outputPath = resolve(argument('--output') ?? 'outputs/dense-text-matrix.json');
  const rounds = Number.parseInt(argument('--rounds') ?? '3', 10);
  const truths = new Map<string, Set<string>>();
  for (const id of IDS) {
    const payload = JSON.parse(await readFile(join(root, 'labels', `${id}.json`), 'utf8')) as { codes: string[] };
    truths.set(id, new Set(payload.codes));
  }

  const codexRows: Array<Record<string, unknown> & Score & { latencyMs: number }> = [];
  for (const model of CODEX_MODELS) {
    for (let round = 1; round <= rounds; round += 1) {
      const run = JSON.parse(await readFile(join(codexDir, `${model}-round${round}.json`), 'utf8')) as CodexRun;
      if (run.model !== model || run.round !== round || run.images.length !== IDS.length) {
        throw new Error(`Invalid Codex run ${model} round ${round}`);
      }
      for (const image of run.images) {
        const truth = truths.get(image.id);
        if (!truth) throw new Error(`Unexpected image ${image.id}`);
        const scored = score(truth, image.text);
        const latencyMs = Date.parse(image.endedAt) - Date.parse(image.startedAt);
        if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error(`Invalid timing for ${model}/${round}/${image.id}`);
        codexRows.push({ model, round, id: image.id, ...scored, latencyMs, outputCharacters: image.text.length });
      }
    }
  }

  const deepseek = JSON.parse(await readFile(join(root, 'results', 'deepseek-dense.json'), 'utf8')) as {
    model: string;
    rows: Array<Score & {
      id: string; round: number; strategy: string; latencyMs: number; imageCount: number;
      usage: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };
      predictedCodes: number; matchedCodes: number; groundTruthCodes: number; text: string;
    }>;
  };
  const deepseekRows = deepseek.rows.filter((row) => row.round <= rounds).map((row) => ({
    model: `deepseek-${row.strategy}`,
    round: row.round,
    id: row.id,
    predicted: row.predictedCodes,
    matched: row.matchedCodes,
    truth: row.groundTruthCodes,
    recall: row.recall,
    precision: row.precision,
    f1: row.f1,
    latencyMs: row.latencyMs,
    imageCount: row.imageCount,
    usage: row.usage,
    outputCharacters: row.text.length,
  }));

  const modelOrder = ['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra', 'deepseek-v2-plugin', 'deepseek-direct'];
  const allRows = [...codexRows, ...deepseekRows];
  const summaries = modelOrder.map((model) => {
    const rows = allRows.filter((row) => row.model === model) as Array<Score & {
      latencyMs: number; imageCount?: number; usage?: {
        prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number;
      };
    }>;
    const base = aggregate(rows);
    if (model.startsWith('deepseek-')) {
      const promptTokens = rows.reduce((sum, row) => sum + (row.usage?.prompt_tokens ?? 0), 0);
      const completionTokens = rows.reduce((sum, row) => sum + (row.usage?.completion_tokens ?? 0), 0);
      const cacheHitTokens = rows.reduce((sum, row) => sum + (row.usage?.prompt_cache_hit_tokens ?? 0), 0);
      const cacheMissTokens = rows.reduce((sum, row) => sum + (row.usage?.prompt_cache_miss_tokens ?? 0), 0);
      const actualPriceCny = (cacheHitTokens * 0.02 + cacheMissTokens * 1 + completionTokens * 2) / 1_000_000;
      const coldCachePriceCny = (promptTokens * 1 + completionTokens * 2) / 1_000_000;
      return {
        model,
        ...base,
        promptTokens,
        completionTokens,
        tokensPerRun: (promptTokens + completionTokens) / rows.length,
        meanImages: rows.reduce((sum, row) => sum + (row.imageCount ?? 0), 0) / rows.length,
        actualPriceCny,
        actualPriceCnyPerRun: actualPriceCny / rows.length,
        coldCachePriceCny,
        coldCachePriceCnyPerRun: coldCachePriceCny / rows.length,
      };
    }
    return {
      model,
      ...base,
      promptTokens: null,
      completionTokens: null,
      tokensPerRun: null,
      meanImages: 1,
      actualPriceCny: null,
      actualPriceCnyPerRun: null,
      coldCachePriceCny: null,
      coldCachePriceCnyPerRun: null,
      unavailableReason: 'Codex subscription run does not expose per-task vision/input token accounting or a billable per-task API price.',
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    benchmark: 'synthetic dense text exact-code recognition',
    seed: 20260823,
    pages: IDS,
    codesPerPage: 100,
    rounds,
    experimentalUnit: 'page (n=4); three runs are technical repeats',
    primaryMetric: 'micro exact-code F1 over unique eight-character codes',
    pricing: {
      currency: 'CNY',
      date: '2026-08-23',
      deepseekRatesPerMillionTokens: { cacheHitInput: 0.02, cacheMissInput: 1, output: 2 },
      pricingCaveat: 'Estimated using the published DeepSeek-V4-Flash rate; the experimental vision model is not separately listed on the public pricing table.',
      codexModels: 'not exposed',
    },
    summaries,
    rows: allRows,
  };
  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify({ outputPath, summaries }, null, 2));
}

await main();
