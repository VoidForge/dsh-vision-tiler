import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

interface PageConfig {
  id: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  fontSize: number;
  foreground: string;
  background: string;
  grid: string;
  clutterLines: number;
}

const DEFAULT_OUTPUT_DIR = 'D:\\CodexData\\dsh-vision-tiler\\DenseText';
const SEED = 20260823;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONFIGS: PageConfig[] = [
  { id: 'D01', width: 2400, height: 1200, columns: 5, rows: 20, fontSize: 18,
    foreground: '#111111', background: '#ffffff', grid: '#d8d8d8', clutterLines: 0 },
  { id: 'D02', width: 1200, height: 2400, columns: 4, rows: 25, fontSize: 17,
    foreground: '#181818', background: '#fbfbfb', grid: '#dedede', clutterLines: 0 },
  { id: 'D03', width: 2600, height: 1600, columns: 5, rows: 20, fontSize: 14,
    foreground: '#626262', background: '#f4f2ee', grid: '#d4d0ca', clutterLines: 0 },
  { id: 'D04', width: 1800, height: 2600, columns: 4, rows: 25, fontSize: 16,
    foreground: '#282828', background: '#f8f8f5', grid: '#d9d9d4', clutterLines: 70 },
];

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function makeUniqueCodes(random: () => number, count: number): string[] {
  const seen = new Set<string>();
  while (seen.size < count) {
    let code = '';
    for (let index = 0; index < 8; index += 1) {
      code += ALPHABET[Math.floor(random() * ALPHABET.length)];
    }
    seen.add(code);
  }
  return [...seen];
}

function renderSvg(config: PageConfig, codes: readonly string[], random: () => number): string {
  const left = 48;
  const right = 48;
  const top = 104;
  const bottom = 42;
  const cellWidth = (config.width - left - right) / config.columns;
  const cellHeight = (config.height - top - bottom) / config.rows;
  const elements: string[] = [
    `<rect width="${config.width}" height="${config.height}" fill="${config.background}"/>`,
    `<text x="${left}" y="44" font-family="Arial, sans-serif" font-size="20" fill="#444">DENSE CODE GRID · PAGE ${config.id}</text>`,
    `<text x="${left}" y="72" font-family="Arial, sans-serif" font-size="13" fill="#777">100 independent 8-character codes · read row by row</text>`,
  ];

  for (let column = 0; column <= config.columns; column += 1) {
    const x = left + column * cellWidth;
    elements.push(`<line x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${config.height - bottom}" stroke="${config.grid}" stroke-width="1"/>`);
  }
  for (let row = 0; row <= config.rows; row += 1) {
    const y = top + row * cellHeight;
    elements.push(`<line x1="${left}" y1="${y.toFixed(2)}" x2="${config.width - right}" y2="${y.toFixed(2)}" stroke="${config.grid}" stroke-width="1"/>`);
  }

  for (let index = 0; index < config.clutterLines; index += 1) {
    const x1 = left + random() * (config.width - left - right);
    const x2 = left + random() * (config.width - left - right);
    const y = top + random() * (config.height - top - bottom);
    elements.push(`<line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y + random() * 5 - 2.5).toFixed(1)}" stroke="#d1d1cc" stroke-width="1" opacity="0.45"/>`);
  }

  for (let row = 0; row < config.rows; row += 1) {
    for (let column = 0; column < config.columns; column += 1) {
      const index = row * config.columns + column;
      const x = left + column * cellWidth + Math.max(12, cellWidth * 0.08);
      const y = top + row * cellHeight + cellHeight * 0.64;
      elements.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Consolas, 'Courier New', monospace" font-size="${config.fontSize}" font-weight="500" letter-spacing="1.1" fill="${config.foreground}">${escapeXml(codes[index])}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${config.width}" height="${config.height}" viewBox="0 0 ${config.width} ${config.height}">${elements.join('')}</svg>`;
}

async function main(): Promise<void> {
  const root = resolve(argument('--output-dir') ?? DEFAULT_OUTPUT_DIR);
  const imagesDir = join(root, 'images');
  const labelsDir = join(root, 'labels');
  await mkdir(imagesDir, { recursive: true });
  await mkdir(labelsDir, { recursive: true });
  const manifest: Array<Record<string, unknown>> = [];

  for (let pageIndex = 0; pageIndex < CONFIGS.length; pageIndex += 1) {
    const config = CONFIGS[pageIndex];
    const random = mulberry32(SEED + pageIndex * 9973);
    const codes = makeUniqueCodes(random, config.columns * config.rows);
    const svg = renderSvg(config, codes, random);
    const imagePath = join(imagesDir, `${config.id}.png`);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(imagePath);
    await writeFile(join(labelsDir, `${config.id}.txt`), `${codes.join('\n')}\n`, 'utf8');
    await writeFile(join(labelsDir, `${config.id}.json`), JSON.stringify({
      id: config.id,
      seed: SEED + pageIndex * 9973,
      readingOrder: 'row-major',
      codePattern: '^[A-Z2-9]{8}$ (letters exclude I and O; digits exclude 0 and 1)',
      config,
      codes,
    }, null, 2), 'utf8');
    manifest.push({ id: config.id, imagePath, labelPath: join(labelsDir, `${config.id}.json`), codeCount: codes.length, config });
    console.log(`${config.id}: ${config.width}x${config.height}, codes=${codes.length}, ${imagePath}`);
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ seed: SEED, pages: manifest }, null, 2), 'utf8');
}

await main();
