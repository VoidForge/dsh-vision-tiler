import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { prepareImageBatch } from '../lib/core/image-tiler.js';

type Strategy = 'direct' | 'v2-plugin';

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

interface RunRow {
  id: string;
  round: number;
  strategy: Strategy;
  imageCount: number;
  coverageTiles: number;
  detailTiles: number;
  predictedCodes: number;
  matchedCodes: number;
  groundTruthCodes: number;
  recall: number;
  precision: number;
  f1: number;
  latencyMs: number;
  usage: Usage;
  text: string;
}

const DEFAULT_DATA_DIR = 'D:\\CodexData\\dsh-vision-tiler\\DenseText';
const MODEL = 'deepseek-v4-flash-vision-exp';
const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const SAMPLE_IDS = ['D01', 'D02', 'D03', 'D04'];
const STRATEGIES: Strategy[] = ['direct', 'v2-plugin'];
const SEED = 20260823;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function extractCodes(text: string): Set<string> {
  return new Set(text.toUpperCase().match(/(?<![A-Z0-9])[A-Z0-9]{8}(?![A-Z0-9])/g) ?? []);
}

function score(groundTruth: Set<string>, prediction: string): {
  predicted: number; matched: number; recall: number; precision: number; f1: number;
} {
  const predicted = extractCodes(prediction);
  let matched = 0;
  for (const code of groundTruth) if (predicted.has(code)) matched += 1;
  const recall = groundTruth.size === 0 ? 1 : matched / groundTruth.size;
  const precision = predicted.size === 0 ? 0 : matched / predicted.size;
  const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  return { predicted: predicted.size, matched, recall, precision, f1 };
}

function dataUrl(data: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`;
}

function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function imageLabels(prepared: Awaited<ReturnType<typeof prepareImageBatch>>): Array<{ label: string; mediaType: string; data: Uint8Array }> {
  return prepared.images.map((image) => ({
    label: image.kind === 'overview'
      ? 'OVERVIEW — use only for layout; tiny codes must be confirmed from tiles'
      : `${image.kind === 'detail' ? 'DETAIL MAGNIFICATION' : 'BASE COVERAGE'} ${image.tile?.id} ` +
        `(x=${image.tile?.left}, y=${image.tile?.top}, w=${image.tile?.width}, h=${image.tile?.height})`,
    mediaType: image.mediaType,
    data: image.data,
  }));
}

async function callDeepSeek(
  apiKey: string,
  images: readonly { label: string; mediaType: string; data: Uint8Array }[],
): Promise<{ text: string; usage: Usage; latencyMs: number }> {
  const content: Array<Record<string, unknown>> = [{
    type: 'text',
    text: [
      'Read every 8-character uppercase alphanumeric code in this document.',
      'There are exactly 100 unique codes. Return only the codes, one per line, in row-major reading order.',
      'Do not output headers, row numbers, explanations, punctuation, or markdown.',
      'Do not infer a code: copy all eight characters exactly.',
      'When overview and overlapping crops are supplied, inspect every crop, cover all four edges, and deduplicate overlaps.',
    ].join(' '),
  }];
  for (const image of images) {
    content.push({ type: 'text', text: image.label });
    content.push({ type: 'image_url', image_url: { url: dataUrl(image.data, image.mediaType), detail: 'original' } });
  }

  const overallStart = performance.now();
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content }],
          thinking: { type: 'disabled' },
          temperature: 0,
          max_tokens: 3000,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const payload = await response.json() as {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string } }>;
        usage?: Usage;
      };
      if (response.ok) {
        const text = payload.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || text.trim().length === 0) throw new Error('DeepSeek returned empty text content');
        return { text, usage: payload.usage ?? {}, latencyMs: performance.now() - overallStart };
      }
      lastError = new Error(`DeepSeek HTTP ${response.status}: ${payload.error?.message ?? response.statusText}`);
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500 * (attempt + 1)));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 3) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error('DeepSeek request failed');
}

async function groundTruth(dataDir: string, id: string): Promise<Set<string>> {
  const payload = JSON.parse(await readFile(join(dataDir, 'labels', `${id}.json`), 'utf8')) as { codes?: string[] };
  if (!Array.isArray(payload.codes) || payload.codes.length !== 100) throw new Error(`Invalid labels for ${id}`);
  return new Set(payload.codes);
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

async function main(): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required');
  const dataDir = resolve(argument('--data-dir') ?? DEFAULT_DATA_DIR);
  const rounds = Number.parseInt(argument('--rounds') ?? '3', 10);
  if (!Number.isInteger(rounds) || rounds < 2 || rounds > 10) throw new Error('--rounds must be from 2 to 10');
  const resultsDir = join(dataDir, 'results');
  await mkdir(resultsDir, { recursive: true });
  const progressPath = join(resultsDir, 'deepseek-dense.progress.json');
  let rows: RunRow[] = [];
  try {
    const existing = JSON.parse(await readFile(progressPath, 'utf8')) as { model?: string; rows?: RunRow[] };
    if (existing.model === MODEL && Array.isArray(existing.rows)) rows = existing.rows;
  } catch {
    // Fresh run.
  }

  const schedule = seededShuffle(
    Array.from({ length: rounds }, (_, roundIndex) => SAMPLE_IDS.flatMap((id) =>
      STRATEGIES.map((strategy) => ({ id, round: roundIndex + 1, strategy })),
    )).flat(),
    SEED,
  );

  for (const task of schedule) {
    const key = `${task.id}:${task.round}:${task.strategy}`;
    if (rows.some((row) => `${row.id}:${row.round}:${row.strategy}` === key)) {
      console.log(`${key}: resume hit`);
      continue;
    }
    const input = await readFile(join(dataDir, 'images', `${task.id}.png`));
    const truth = await groundTruth(dataDir, task.id);
    let images: Array<{ label: string; mediaType: string; data: Uint8Array }>;
    let coverageTiles = 0;
    let detailTiles = 0;
    if (task.strategy === 'direct') {
      images = [{ label: 'ORIGINAL IMAGE', mediaType: 'image/png', data: input }];
    } else {
      const prepared = await prepareImageBatch(input, {
        mode: 'document',
        strategy: 'adaptive',
        detailCropCount: 1,
        detailCropSide: 512,
        includeOverview: true,
        maxImagesPerBatch: 20,
      });
      if (prepared.batchCount !== 1) throw new Error(`${task.id} unexpectedly requires ${prepared.batchCount} batches`);
      images = imageLabels(prepared);
      coverageTiles = prepared.plan.tiles.length;
      detailTiles = prepared.detailTiles.length;
    }
    const response = await callDeepSeek(apiKey, images);
    const scored = score(truth, response.text);
    const row: RunRow = {
      id: task.id,
      round: task.round,
      strategy: task.strategy,
      imageCount: images.length,
      coverageTiles,
      detailTiles,
      predictedCodes: scored.predicted,
      matchedCodes: scored.matched,
      groundTruthCodes: truth.size,
      recall: scored.recall,
      precision: scored.precision,
      f1: scored.f1,
      latencyMs: response.latencyMs,
      usage: response.usage,
      text: response.text,
    };
    rows.push(row);
    await writeFile(progressPath, JSON.stringify({ model: MODEL, seed: SEED, rows }, null, 2), 'utf8');
    console.log(`${key}: images=${row.imageCount}, recall=${(row.recall * 100).toFixed(1)}%, precision=${(row.precision * 100).toFixed(1)}%, latency=${(row.latencyMs / 1000).toFixed(1)}s`);
  }

  const summaries = STRATEGIES.map((strategy) => {
    const selected = rows.filter((row) => row.strategy === strategy && row.round <= rounds);
    const totalMatched = selected.reduce((sum, row) => sum + row.matchedCodes, 0);
    const totalTruth = selected.reduce((sum, row) => sum + row.groundTruthCodes, 0);
    const totalPredicted = selected.reduce((sum, row) => sum + row.predictedCodes, 0);
    const recall = totalTruth === 0 ? 1 : totalMatched / totalTruth;
    const precision = totalPredicted === 0 ? 0 : totalMatched / totalPredicted;
    return {
      strategy,
      runs: selected.length,
      documentUnits: SAMPLE_IDS.length,
      technicalRepeats: rounds,
      microRecall: recall,
      microPrecision: precision,
      microF1: recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision),
      medianLatencyMs: percentile(selected.map((row) => row.latencyMs), 0.5),
      p95LatencyMs: percentile(selected.map((row) => row.latencyMs), 0.95),
      promptTokens: selected.reduce((sum, row) => sum + (row.usage.prompt_tokens ?? 0), 0),
      completionTokens: selected.reduce((sum, row) => sum + (row.usage.completion_tokens ?? 0), 0),
      cacheHitTokens: selected.reduce((sum, row) => sum + (row.usage.prompt_cache_hit_tokens ?? 0), 0),
      cacheMissTokens: selected.reduce((sum, row) => sum + (row.usage.prompt_cache_miss_tokens ?? 0), 0),
      meanImages: selected.reduce((sum, row) => sum + row.imageCount, 0) / selected.length,
    };
  });
  const output = {
    model: MODEL,
    endpoint: ENDPOINT,
    thinking: 'disabled',
    seed: SEED,
    rounds,
    samples: SAMPLE_IDS,
    codeCountPerSample: 100,
    experimentalUnit: 'document page (n=4)',
    repeatedRuns: 'technical repeats; not treated as independent documents',
    schedule: 'seeded random order across page, round, and DeepSeek strategy',
    summaries,
    rows: rows.sort((a, b) => a.round - b.round || a.id.localeCompare(b.id) || a.strategy.localeCompare(b.strategy)),
  };
  await writeFile(join(resultsDir, 'deepseek-dense.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify({ ...output, rows: undefined }, null, 2));
}

await main();
