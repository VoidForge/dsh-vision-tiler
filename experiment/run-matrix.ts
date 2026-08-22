import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { prepareImageBatch } from '../lib/core/image-tiler.js';

type Strategy = 'direct' | 'v1-uniform' | 'v2-adaptive-lite' | 'v2-adaptive';

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
  matchedWords: number;
  groundTruthWords: number;
  recall: number;
  latencyMs: number;
  usage: Usage;
  text: string;
}

interface SampleMaterial {
  groundTruth: Set<string>;
  direct: Array<{ label: string; mediaType: string; data: Uint8Array }>;
  v1: Array<{ label: string; mediaType: string; data: Uint8Array }>;
  v2: Array<{ label: string; mediaType: string; data: Uint8Array }>;
  v2Lite: Array<{ label: string; mediaType: string; data: Uint8Array }>;
  v1CoverageTiles: number;
  v2CoverageTiles: number;
  v2DetailTiles: number;
  v2LiteDetailTiles: number;
}

const DEFAULT_DATA_DIR = 'D:\\CodexData\\dsh-vision-tiler\\DocumentVQA';
const MODEL = 'deepseek-v4-flash-vision-exp';
const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const SAMPLE_IDS = ['008', '009', '010', '011'];
const STRATEGIES: Strategy[] = ['direct', 'v1-uniform', 'v2-adaptive-lite', 'v2-adaptive'];
const SEED = 20260823;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeWords(text: string): Set<string> {
  const normalized = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim();
  return new Set(normalized.split(/\s+/).filter((word) => word.length >= 2));
}

function score(groundTruth: Set<string>, prediction: string): { matched: number; recall: number } {
  const words = normalizeWords(prediction);
  let matched = 0;
  for (const word of groundTruth) if (words.has(word)) matched += 1;
  return { matched, recall: groundTruth.size === 0 ? 1 : matched / groundTruth.size };
}

async function readGroundTruth(path: string): Promise<Set<string>> {
  const text = await readFile(path, 'utf8');
  return normalizeWords(text.split(/\r?\n/).filter(Boolean)
    .map((line) => line.split(',').slice(8).join(',')).join('\n'));
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

async function callDeepSeek(
  apiKey: string,
  images: readonly { label: string; mediaType: string; data: Uint8Array }[],
): Promise<{ text: string; usage: Usage; latencyMs: number }> {
  const content: Array<Record<string, unknown>> = [{
    type: 'text',
    text: [
      'Transcribe every visible word and number in this receipt.',
      'Return only the transcription, without explanation or markdown.',
      'Inspect the first and last visible line and all left, right, top, and bottom edges.',
      'If overview, overlapping base tiles, or detail crops are present, read every image and merge duplicate overlap text exactly once.',
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
        max_tokens: 2048,
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

function labels(prepared: Awaited<ReturnType<typeof prepareImageBatch>>): Array<{ label: string; mediaType: string; data: Uint8Array }> {
  return prepared.images.map((image) => ({
    label: image.kind === 'overview'
      ? 'OVERVIEW'
      : `${image.kind === 'detail' ? 'DETAIL MAGNIFICATION' : 'BASE COVERAGE'} ${image.tile?.id} ` +
        `(x=${image.tile?.left}, y=${image.tile?.top}, w=${image.tile?.width}, h=${image.tile?.height})`,
    mediaType: image.mediaType,
    data: image.data,
  }));
}

async function prepareMaterial(imagesDir: string, id: string): Promise<SampleMaterial> {
  const input = await readFile(join(imagesDir, `${id}.jpg`));
  const groundTruth = await readGroundTruth(join(imagesDir, `${id}.csv`));
  const v1 = await prepareImageBatch(input, {
    mode: 'document', strategy: 'uniform', detailCropCount: 0, includeOverview: true, maxImagesPerBatch: 20,
  });
  const v2 = await prepareImageBatch(input, {
    mode: 'document', strategy: 'adaptive', detailCropCount: 2, detailCropSide: 512,
    includeOverview: true, maxImagesPerBatch: 20,
  });
  const v2Lite = await prepareImageBatch(input, {
    mode: 'document', strategy: 'adaptive', detailCropCount: 1, detailCropSide: 512,
    includeOverview: true, maxImagesPerBatch: 20,
  });
  if (v1.batchCount !== 1 || v2.batchCount !== 1 || v2Lite.batchCount !== 1) {
    throw new Error(`${id} unexpectedly requires multiple batches`);
  }
  return {
    groundTruth,
    direct: [{ label: 'ORIGINAL IMAGE', mediaType: 'image/jpeg', data: input }],
    v1: labels(v1),
    v2: labels(v2),
    v2Lite: labels(v2Lite),
    v1CoverageTiles: v1.plan.tiles.length,
    v2CoverageTiles: v2.plan.tiles.length,
    v2DetailTiles: v2.detailTiles.length,
    v2LiteDetailTiles: v2Lite.detailTiles.length,
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

async function main(): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required');
  const dataDir = resolve(argument('--data-dir') ?? process.env.DSH_VISION_TILER_DATA_DIR ?? DEFAULT_DATA_DIR);
  const rounds = Number.parseInt(argument('--rounds') ?? '3', 10);
  if (!Number.isInteger(rounds) || rounds < 2 || rounds > 10) throw new Error('--rounds must be from 2 to 10');
  const imagesDir = join(dataDir, 'images');
  const resultsDir = join(dataDir, 'results');
  await mkdir(resultsDir, { recursive: true });
  const progressPath = join(resultsDir, 'deepseek-matrix-v2.progress.json');
  let rows: RunRow[] = [];
  try {
    const existing = JSON.parse(await readFile(progressPath, 'utf8')) as { model?: string; rows?: RunRow[] };
    if (existing.model === MODEL && Array.isArray(existing.rows)) rows = existing.rows;
  } catch {
    // Fresh run.
  }

  const materials = new Map<string, SampleMaterial>();
  for (const id of SAMPLE_IDS) materials.set(id, await prepareMaterial(imagesDir, id));
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
    const material = materials.get(task.id);
    if (!material) throw new Error(`missing material ${task.id}`);
    const images = task.strategy === 'direct' ? material.direct
      : task.strategy === 'v1-uniform' ? material.v1
        : task.strategy === 'v2-adaptive-lite' ? material.v2Lite : material.v2;
    const response = await callDeepSeek(apiKey, images);
    const scored = score(material.groundTruth, response.text);
    const row: RunRow = {
      id: task.id,
      round: task.round,
      strategy: task.strategy,
      imageCount: images.length,
      coverageTiles: task.strategy === 'direct' ? 0 : task.strategy === 'v1-uniform' ? material.v1CoverageTiles : material.v2CoverageTiles,
      detailTiles: task.strategy === 'v2-adaptive' ? material.v2DetailTiles
        : task.strategy === 'v2-adaptive-lite' ? material.v2LiteDetailTiles : 0,
      matchedWords: scored.matched,
      groundTruthWords: material.groundTruth.size,
      recall: scored.recall,
      latencyMs: response.latencyMs,
      usage: response.usage,
      text: response.text,
    };
    rows.push(row);
    await writeFile(progressPath, JSON.stringify({ model: MODEL, seed: SEED, rows }, null, 2), 'utf8');
    console.log(`${key}: images=${row.imageCount}, recall=${(row.recall * 100).toFixed(1)}%, latency=${(row.latencyMs / 1000).toFixed(1)}s`);
  }

  const summaries = STRATEGIES.map((strategy) => {
    const selected = rows.filter((row) => row.strategy === strategy && row.round <= rounds);
    return {
      strategy,
      runs: selected.length,
      meanRecall: selected.reduce((sum, row) => sum + row.recall, 0) / selected.length,
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
    schedule: 'seeded random order across sample, round, and strategy',
    summaries,
    rows: rows.sort((a, b) => a.round - b.round || a.id.localeCompare(b.id) || a.strategy.localeCompare(b.strategy)),
  };
  await writeFile(join(resultsDir, 'deepseek-matrix-v2.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify({ ...output, rows: undefined }, null, 2));
}

await main();
