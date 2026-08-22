import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prepareImageBatch } from '../lib/core/image-tiler.js';

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface Row {
  id: string;
  width: number;
  height: number;
  tileCount: number;
  tiledImageCount: number;
  groundTruthUniqueWords: number;
  directMatchedWords: number;
  tiledMatchedWords: number;
  directRecall: number;
  tiledRecall: number;
  absoluteGain: number;
  directText: string;
  tiledText: string;
  directUsage: Usage;
  tiledUsage: Usage;
  geometricCoverage: number;
  uncoveredPixels: number;
}

const DEFAULT_DATA_DIR = 'D:\\CodexData\\dsh-vision-tiler\\DocumentVQA';
const MODEL = 'deepseek-v4-flash-vision-exp';
const ENDPOINT = 'https://api.deepseek.com/chat/completions';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeWords(text: string): Set<string> {
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
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
  return normalizeWords(
    text.split(/\r?\n/).filter(Boolean).map((line) => line.split(',').slice(8).join(',')).join('\n'),
  );
}

function dataUrl(data: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`;
}

async function callDeepSeek(
  apiKey: string,
  images: readonly { label: string; mediaType: string; data: Uint8Array }[],
): Promise<{ text: string; usage: Usage }> {
  const content: Array<Record<string, unknown>> = [{
    type: 'text',
    text: [
      'Transcribe every visible word and number in this receipt.',
      'Return only the transcription, without explanation or markdown.',
      'When multiple overlapping tiles are supplied, inspect every tile, merge duplicate overlap text, and do not omit small edge or footer text.',
    ].join(' '),
  }];
  for (const image of images) {
    content.push({ type: 'text', text: image.label });
    content.push({
      type: 'image_url',
      image_url: { url: dataUrl(image.data, image.mediaType), detail: 'original' },
    });
  }

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
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
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('DeepSeek returned empty text content');
      }
      return { text, usage: payload.usage ?? {} };
    }
    lastError = new Error(`DeepSeek HTTP ${response.status}: ${payload.error?.message ?? response.statusText}`);
    if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500 * (attempt + 1)));
  }
  throw lastError ?? new Error('DeepSeek request failed');
}

async function writeProgress(resultsPath: string, rows: Row[]): Promise<void> {
  await writeFile(resultsPath, JSON.stringify({ model: MODEL, rows }, null, 2), 'utf8');
}

async function main(): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required');
  const dataDir = resolve(argument('--data-dir') ?? process.env.DSH_VISION_TILER_DATA_DIR ?? DEFAULT_DATA_DIR);
  const limit = Number.parseInt(argument('--limit') ?? '12', 10);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 12) {
    throw new Error('--limit must be an integer from 1 to 12');
  }
  const imagesDir = join(dataDir, 'images');
  const resultsDir = join(dataDir, 'results');
  await mkdir(resultsDir, { recursive: true });
  const resultsPath = join(resultsDir, 'deepseek-vision-comparison.progress.json');
  let rows: Row[] = [];
  try {
    const existing = JSON.parse(await readFile(resultsPath, 'utf8')) as { model?: string; rows?: Row[] };
    if (existing.model === MODEL && Array.isArray(existing.rows)) {
      rows = existing.rows.filter((row) => row.directText.trim().length > 0 && row.tiledText.trim().length > 0);
    }
  } catch {
    // Fresh run.
  }

  for (let index = 0; index < limit; index += 1) {
    const id = String(index).padStart(3, '0');
    if (rows.some((row) => row.id === id)) {
      console.log(`${id}: resume hit, skipped`);
      continue;
    }
    const input = await readFile(join(imagesDir, `${id}.jpg`));
    const groundTruth = await readGroundTruth(join(imagesDir, `${id}.csv`));
    const tiled = await prepareImageBatch(input, {
      mode: 'document',
      includeOverview: true,
      maxImagesPerBatch: 20,
      batchIndex: 0,
    });
    if (tiled.batchCount !== 1) throw new Error(`${id} requires multiple API batches; sample set assumption failed`);

    const direct = await callDeepSeek(apiKey, [{
      label: 'ORIGINAL IMAGE',
      mediaType: 'image/jpeg',
      data: input,
    }]);
    const tiledInputs = tiled.plan.tiles.length === 1
      ? [{ label: 'ORIGINAL IMAGE (no split needed)', mediaType: 'image/jpeg', data: input }]
      : tiled.images.map((image) => ({
        label: image.kind === 'overview'
          ? 'OVERVIEW'
          : `${image.tile?.id} at x=${image.tile?.left}, y=${image.tile?.top}, w=${image.tile?.width}, h=${image.tile?.height}`,
        mediaType: image.mediaType,
        data: image.data,
      }));
    const tiledResponse = tiled.plan.tiles.length === 1
      ? direct
      : await callDeepSeek(apiKey, tiledInputs);

    const directScore = score(groundTruth, direct.text);
    const tiledScore = score(groundTruth, tiledResponse.text);
    const row: Row = {
      id,
      width: tiled.originalWidth,
      height: tiled.originalHeight,
      tileCount: tiled.plan.tiles.length,
      tiledImageCount: tiledInputs.length,
      groundTruthUniqueWords: groundTruth.size,
      directMatchedWords: directScore.matched,
      tiledMatchedWords: tiledScore.matched,
      directRecall: directScore.recall,
      tiledRecall: tiledScore.recall,
      absoluteGain: tiledScore.recall - directScore.recall,
      directText: direct.text,
      tiledText: tiledResponse.text,
      directUsage: direct.usage,
      tiledUsage: tiledResponse.usage,
      geometricCoverage: tiled.plan.audit.coverageRatio,
      uncoveredPixels: tiled.plan.audit.uncoveredPixels,
    };
    rows.push(row);
    rows.sort((a, b) => a.id.localeCompare(b.id));
    await writeProgress(resultsPath, rows);
    console.log(
      `${id}: tiles=${row.tileCount}, images=${row.tiledImageCount}, ` +
      `recall ${(row.directRecall * 100).toFixed(1)}% -> ${(row.tiledRecall * 100).toFixed(1)}%`,
    );
  }

  const selected = rows.filter((row) => Number.parseInt(row.id, 10) < limit);
  const macroDirect = selected.reduce((sum, row) => sum + row.directRecall, 0) / selected.length;
  const macroTiled = selected.reduce((sum, row) => sum + row.tiledRecall, 0) / selected.length;
  const totalGroundTruth = selected.reduce((sum, row) => sum + row.groundTruthUniqueWords, 0);
  const microDirect = selected.reduce((sum, row) => sum + row.directMatchedWords, 0) / totalGroundTruth;
  const microTiled = selected.reduce((sum, row) => sum + row.tiledMatchedWords, 0) / totalGroundTruth;
  const summary = {
    model: MODEL,
    endpoint: ENDPOINT,
    thinking: 'disabled',
    dataset: 'ICDAR 2019 SROIE samples 000-011',
    sampleCount: selected.length,
    macroDirectRecall: macroDirect,
    macroTiledRecall: macroTiled,
    macroAbsoluteGain: macroTiled - macroDirect,
    microDirectRecall: microDirect,
    microTiledRecall: microTiled,
    microAbsoluteGain: microTiled - microDirect,
    improved: selected.filter((row) => row.absoluteGain > 1e-12).length,
    unchanged: selected.filter((row) => Math.abs(row.absoluteGain) <= 1e-12).length,
    regressed: selected.filter((row) => row.absoluteGain < -1e-12).length,
    allGeometricallyCovered: selected.every((row) => row.uncoveredPixels === 0 && row.geometricCoverage === 1),
    promptTokens: selected.reduce((sum, row) => sum + (row.directUsage.prompt_tokens ?? 0) + (row.tileCount === 1 ? 0 : (row.tiledUsage.prompt_tokens ?? 0)), 0),
    completionTokens: selected.reduce((sum, row) => sum + (row.directUsage.completion_tokens ?? 0) + (row.tileCount === 1 ? 0 : (row.tiledUsage.completion_tokens ?? 0)), 0),
    rows: selected,
  };
  await writeFile(join(resultsDir, 'deepseek-vision-comparison.json'), JSON.stringify(summary, null, 2), 'utf8');
  const tableRows = selected.map((row) =>
    `| ${row.id} | ${row.width}×${row.height} | ${row.tileCount} | ${(row.directRecall * 100).toFixed(1)}% | ${(row.tiledRecall * 100).toFixed(1)}% | ${(row.absoluteGain * 100).toFixed(1)} pp |`,
  ).join('\n');
  const markdown = `# DeepSeek vision tiling experiment\n\n` +
    `- Model: ${MODEL}\n` +
    `- Samples: ${selected.length}\n` +
    `- Macro unique-word recall: ${(macroDirect * 100).toFixed(1)}% → ${(macroTiled * 100).toFixed(1)}% (${((macroTiled - macroDirect) * 100).toFixed(1)} percentage points)\n` +
    `- Micro unique-word recall: ${(microDirect * 100).toFixed(1)}% → ${(microTiled * 100).toFixed(1)}% (${((microTiled - microDirect) * 100).toFixed(1)} percentage points)\n` +
    `- Improved / unchanged / regressed: ${summary.improved} / ${summary.unchanged} / ${summary.regressed}\n` +
    `- Exact geometric coverage: ${summary.allGeometricallyCovered ? '100% for every sample' : 'FAILED'}\n` +
    `- Reported prompt/completion tokens: ${summary.promptTokens} / ${summary.completionTokens}\n\n` +
    `| Sample | Original | Tiles | Direct recall | Tiled recall | Gain |\n` +
    `|---|---:|---:|---:|---:|---:|\n${tableRows}\n`;
  await writeFile(join(resultsDir, 'deepseek-vision-comparison.md'), markdown, 'utf8');
  console.log(JSON.stringify({ ...summary, rows: undefined }, null, 2));
}

await main();
