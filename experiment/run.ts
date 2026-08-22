import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { prepareImageBatch } from '../lib/core/image-tiler.js';

interface SampleResult {
  id: string;
  width: number;
  height: number;
  baselineWidth: number;
  baselineHeight: number;
  tileCount: number;
  groundTruthUniqueWords: number;
  baselineMatchedWords: number;
  tiledMatchedWords: number;
  baselineRecall: number;
  tiledRecall: number;
  absoluteGain: number;
  relativeGain: number | null;
  baselineOcrMs: number;
  tiledOcrMs: number;
  geometricCoverage: number;
  uncoveredPixels: number;
}

const DEFAULT_DATA_DIR = 'D:\\CodexData\\dsh-vision-tiler\\DocumentVQA';
const DEEPSEEK_MAX_IMAGE_PIXELS = 800 * 800;

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

function recall(groundTruth: Set<string>, prediction: Set<string>): { matched: number; recall: number } {
  let matched = 0;
  for (const word of groundTruth) if (prediction.has(word)) matched += 1;
  return { matched, recall: groundTruth.size === 0 ? 1 : matched / groundTruth.size };
}

async function readGroundTruth(path: string): Promise<string> {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line) => line.split(',').slice(8).join(',')).join('\n');
}

async function baselineImage(input: Uint8Array): Promise<{ data: Buffer; width: number; height: number }> {
  const normalized = await sharp(input).rotate().toColorspace('srgb').png().toBuffer({ resolveWithObject: true });
  const area = normalized.info.width * normalized.info.height;
  const scale = area > DEEPSEEK_MAX_IMAGE_PIXELS
    ? Math.sqrt(DEEPSEEK_MAX_IMAGE_PIXELS / area)
    : 1;
  const width = Math.max(1, Math.round(normalized.info.width * scale));
  const height = Math.max(1, Math.round(normalized.info.height * scale));
  const data = scale < 1
    ? await sharp(normalized.data).resize({ width, height, fit: 'fill' }).png().toBuffer()
    : normalized.data;
  return { data, width, height };
}

async function main(): Promise<void> {
  const dataDir = resolve(argument('--data-dir') ?? process.env.DSH_VISION_TILER_DATA_DIR ?? DEFAULT_DATA_DIR);
  const limit = Number.parseInt(argument('--limit') ?? '12', 10);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 12) {
    throw new Error('--limit must be an integer from 1 to 12');
  }
  const imagesDir = join(dataDir, 'images');
  const generatedDir = join(dataDir, 'generated');
  const resultsDir = join(dataDir, 'results');
  const cacheDir = join(dataDir, 'tesseract-cache');
  const langPath = join(dataDir, 'tessdata', 'package', '4.0.0_best_int');
  await Promise.all([generatedDir, resultsDir, cacheDir].map((path) => mkdir(path, { recursive: true })));

  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    langPath,
    cachePath: cacheDir,
    gzip: true,
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });

  const results: SampleResult[] = [];
  try {
    for (let index = 0; index < limit; index += 1) {
      const id = String(index).padStart(3, '0');
      const input = await readFile(join(imagesDir, `${id}.jpg`));
      const groundTruth = normalizeWords(await readGroundTruth(join(imagesDir, `${id}.csv`)));
      const baseline = await baselineImage(input);
      const sampleDir = join(generatedDir, id);
      await mkdir(sampleDir, { recursive: true });
      await writeFile(join(sampleDir, 'baseline-800eq.png'), baseline.data);

      const baselineStart = performance.now();
      const baselineText = (await worker.recognize(baseline.data)).data.text;
      const baselineOcrMs = performance.now() - baselineStart;
      await writeFile(join(sampleDir, 'baseline.txt'), baselineText, 'utf8');

      const tiled = await prepareImageBatch(input, {
        mode: 'document',
        includeOverview: false,
        maxImagesPerBatch: 256,
        batchIndex: 0,
      });
      const tileTexts: string[] = [];
      const tiledStart = performance.now();
      for (const image of tiled.images) {
        await writeFile(join(sampleDir, image.name), image.data);
        tileTexts.push((await worker.recognize(image.data)).data.text);
      }
      const tiledOcrMs = performance.now() - tiledStart;
      const tiledText = tileTexts.join('\n');
      await writeFile(join(sampleDir, 'tiled.txt'), tiledText, 'utf8');

      const baselineScore = recall(groundTruth, normalizeWords(baselineText));
      const tiledScore = recall(groundTruth, normalizeWords(tiledText));
      const absoluteGain = tiledScore.recall - baselineScore.recall;
      results.push({
        id,
        width: tiled.originalWidth,
        height: tiled.originalHeight,
        baselineWidth: baseline.width,
        baselineHeight: baseline.height,
        tileCount: tiled.plan.tiles.length,
        groundTruthUniqueWords: groundTruth.size,
        baselineMatchedWords: baselineScore.matched,
        tiledMatchedWords: tiledScore.matched,
        baselineRecall: baselineScore.recall,
        tiledRecall: tiledScore.recall,
        absoluteGain,
        relativeGain: baselineScore.recall === 0 ? null : absoluteGain / baselineScore.recall,
        baselineOcrMs,
        tiledOcrMs,
        geometricCoverage: tiled.plan.audit.coverageRatio,
        uncoveredPixels: tiled.plan.audit.uncoveredPixels,
      });
      console.log(
        `${id}: ${tiled.originalWidth}x${tiled.originalHeight}, tiles=${tiled.plan.tiles.length}, ` +
        `recall ${(baselineScore.recall * 100).toFixed(1)}% -> ${(tiledScore.recall * 100).toFixed(1)}%`,
      );
    }
  } finally {
    await worker.terminate();
  }

  const macroBaseline = results.reduce((sum, row) => sum + row.baselineRecall, 0) / results.length;
  const macroTiled = results.reduce((sum, row) => sum + row.tiledRecall, 0) / results.length;
  const totalGroundTruth = results.reduce((sum, row) => sum + row.groundTruthUniqueWords, 0);
  const microBaseline = results.reduce((sum, row) => sum + row.baselineMatchedWords, 0) / totalGroundTruth;
  const microTiled = results.reduce((sum, row) => sum + row.tiledMatchedWords, 0) / totalGroundTruth;
  const improved = results.filter((row) => row.absoluteGain > 1e-12).length;
  const unchanged = results.filter((row) => Math.abs(row.absoluteGain) <= 1e-12).length;
  const regressed = results.filter((row) => row.absoluteGain < -1e-12).length;
  const summary = {
    dataset: 'ICDAR 2019 SROIE (zzzDavid/ICDAR-2019-SROIE, samples 000-011)',
    method: 'Tesseract.js controlled OCR proxy; whole image scaled to <=800x800-equivalent pixels vs 768px overlapping tiles',
    sampleCount: results.length,
    macroBaselineRecall: macroBaseline,
    macroTiledRecall: macroTiled,
    macroAbsoluteGain: macroTiled - macroBaseline,
    microBaselineRecall: microBaseline,
    microTiledRecall: microTiled,
    microAbsoluteGain: microTiled - microBaseline,
    improved,
    unchanged,
    regressed,
    allGeometricallyCovered: results.every((row) => row.uncoveredPixels === 0 && row.geometricCoverage === 1),
    rows: results,
  };
  await writeFile(join(resultsDir, 'sroie-ocr-comparison.json'), JSON.stringify(summary, null, 2), 'utf8');

  const tableRows = results.map((row) =>
    `| ${row.id} | ${row.width}×${row.height} | ${row.tileCount} | ${(row.baselineRecall * 100).toFixed(1)}% | ${(row.tiledRecall * 100).toFixed(1)}% | ${(row.absoluteGain * 100).toFixed(1)} pp |`,
  ).join('\n');
  const markdown = `# SROIE image-tiling experiment\n\n` +
    `This is a controlled OCR proxy for the resolution effect documented by DeepSeek. It is not a DeepSeek model benchmark because no DeepSeek API credential was available in the environment.\n\n` +
    `- Samples: ${results.length}\n` +
    `- Macro unique-word recall: ${(macroBaseline * 100).toFixed(1)}% → ${(macroTiled * 100).toFixed(1)}% (${((macroTiled - macroBaseline) * 100).toFixed(1)} percentage points)\n` +
    `- Micro unique-word recall: ${(microBaseline * 100).toFixed(1)}% → ${(microTiled * 100).toFixed(1)}% (${((microTiled - microBaseline) * 100).toFixed(1)} percentage points)\n` +
    `- Samples improved / unchanged / regressed: ${improved} / ${unchanged} / ${regressed}\n` +
    `- Exact geometric coverage: ${summary.allGeometricallyCovered ? '100% for every sample' : 'FAILED'}\n\n` +
    `| Sample | Original | Tiles | Whole-image recall | Tiled recall | Gain |\n` +
    `|---|---:|---:|---:|---:|---:|\n${tableRows}\n`;
  await writeFile(join(resultsDir, 'sroie-ocr-comparison.md'), markdown, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

await main();
