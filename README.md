# DSH Vision Tiler

[中文说明](README.zh-CN.md) · [Technical report](docs/DSH视觉分块插件v2技术报告.md) · [Dense-text benchmark](docs/密集文字识别五模型补充报告.md)

Full-coverage image tiling for DeepSeek Harness (DSH) vision models. The plugin turns one high-resolution image into a global overview, overlapping coverage tiles, and an optional dense-region detail crop before the model reads it.

![Dense-text benchmark comparison](assets/benchmark-comparison.png)

## Why it exists

DeepSeek prices each image by its dimensions and caps one image at 1024 vision tokens: images below about 544×544 total pixels are scaled up, and larger images are scaled toward a 1300×1300 total-pixel equivalent. A whole page therefore loses small characters in receipts, tables, diagrams, and long screenshots. DSH Vision Tiler gives each local region its own image budget while preserving a complete, auditable view of the source.

- **100% geometric coverage:** coverage tiles are audited against every source pixel.
- **Overlapping seams:** text and shapes that cross a tile edge remain visible in a neighbour.
- **Content-aware cuts:** document mode moves horizontal seams toward low-ink areas.
- **Dense-region review:** an optional 512×512 detail crop supplements, never replaces, base coverage.
- **Bounded batches:** large tile sets are returned in model-safe batches.
- **Traceable output:** each tile carries source coordinates, role, batch state, and coverage, and the batch reports a combined token estimate taken from DSH's own DeepSeek accounting.
- **No native image build:** v0.3.0 uses pure JavaScript plus bundled WebAssembly, avoiding `sharp`/libvips conflicts inside DSH Web.

## Install

Requirements: DeepSeek Harness 0.2.2-rc.5 or later, a vision-capable DSH model profile, and Node.js 22 or later.

Pinned GitHub release:

```shell
dsh plugin --profile web add github:VoidForge/dsh-vision-tiler#v0.3.0
dsh --profile web --dump-config
```

The `v0.3.0` tag is created when the release is published; until then install from `#main`.

No `allow-build` entry is required. Runtime packages are declared in `package.json` and locked in `package-lock.json`; these files are the Node.js equivalent of Python's `requirements.txt`. An npm registry release is planned but is not yet published, so use the pinned GitHub command above.

![DSH Web showing Vision Tiler enabled (v0.2.3 screenshot)](assets/dsh-web-installed-v0.2.3.png)

## Use

Ask the model to call the registered `segment_image` tool and continue through every returned batch:

```text
Call segment_image for D:\images\document.png with mode=document and batch_index=0.
If remaining_batch_indices is not empty, read every remaining batch before answering.
Report uncertain_regions and cite the tile IDs used.
```

| Argument | Meaning |
|---|---|
| `path` | Absolute path, or a path relative to the DSH process directory |
| `mode` | `auto`, `document`, `diagram`, or `photo` |
| `strategy` | `adaptive` (default) or `uniform` (control mode) |
| `batch_index` | Zero-based output batch |

The DSH profile must use a model that accepts image attachments. A text-only route can run the tiler, but it cannot pass the resulting images to the model.

## Configuration

The plugin exposes these options in the DSH plugin settings. `models` decides whether the tool exists for the current model at all.

| Option | Default | Meaning |
|---|---|---|
| `models` | `deepseek-flash`, `deepseek-v4.1` | Model id prefixes this tool is offered for. Matching is case-insensitive and prefix-based, so `deepseek-v4.1` covers `deepseek-v4.1-flash-1017` and provider-qualified ids such as `openrouter/deepseek/deepseek-v4.1-flash-1017`. The earlier `deepseek-v4-flash` and `deepseek-v4-pro` line is not matched by default. `*` allows every model; an empty list hides the tool. |
| `targetTilePixels` | 589824 | Target area of one coverage tile in pixels. |
| `overlapRatio` | per mode | Overlap as a fraction of the tile size: 0.15 auto, 0.18 document, 0.2 diagram, 0.12 photo. |
| `minOverlapPixels` | 64 | Smallest overlap between neighbouring tiles. |
| `maxTotalTiles` | 256 | Tile-count ceiling before the tool refuses the image. |
| `maxImagesPerBatch` | 20 | Images per call, including the overview. |
| `includeOverview` | true | Return the downscaled global overview. |
| `overviewMaxEdge` | 800 | Longest overview edge, at most 4096. |
| `defaultStrategy` | adaptive | Tiling strategy when the caller does not choose one. |
| `detailCropCount` | 1 adaptive, 0 uniform | Dense-region detail crops. |
| `detailCropSide` | 512 | Side of one detail crop. |

The tool is registered per model step, so switching to a model outside `models` hides `segment_image` instead of tiling for a provider that already has its own image pipeline.

As of 2026-11-27, `deepseek-flash` and third-party ids such as `deepseek-v4.1-flash-1017` name the same checkpoint, so the default list covers both spellings. A newer checkpoint published under a different id needs its prefix added to `models`.

## Vision token budget

Every batch reports `estimatedVisionTokens` and `visionTokenCap`. The estimate comes from `deepSeekImageTokens` in `@deepseek-ai/dsh-llm-deepseek`, the accounting DSH uses to price a DeepSeek request, applied to the dimensions of the saved attachments DSH sends. It describes DeepSeek routes only; another provider prices images its own way. The plugin checks at load that the installed package still exports the functions it calls; the arithmetic itself is DSH's. If a DSH release moves or renames them, the plugin refuses to activate with a visible warning.

| Image | Tokens |
|---|---:|
| 512×512 detail crop | 184 |
| 565×800 overview of an A4 page | 302 |
| 768×768 tile (default) | 382 |
| 800×800 overview | 422 |
| 1024×1024 tile | 652 |
| 1302×1302 tile, the largest square the provider keeps | 994 |
| any image, provider cap | 1024 |

A coverage tile or detail crop that DSH or the provider would downscale or project is rejected with a `RangeError`, so `targetTilePixels` and `detailCropSide` must keep every image inside the budget. Provider upscaling below the 544×544 floor is allowed. `overviewMaxEdge` must stay at or below the exported per-side request limit, 4096 today; the overview is a preview and may be projected. The no-resize guard assumes the attachment store's default normalization budget; a profile that lowers `normalizedImageMaxPixels` or `normalizedImageMaxDimension` can still downscale a saved tile, and the estimate then prices the saved size. The estimate assumes the default high/original detail route: any `imagePixelBudget` override on a model route, such as `low` (512×512), prices images differently and is out of scope. The `usage` field returned by the API remains authoritative.

## Measured results

The controlled dense-text benchmark contains four synthetic pages with 100 unique eight-character codes each. Every model arm read each page independently three times: 12 calls and 1,200 exact-code decisions per arm. These runs predate the 1024-token model: they used the v4/384 accounting and the plugin's 768 px defaults.

| Configuration | Exact-code F1 | Median latency | Mean total tokens/call | Estimated cost/call |
|---|---:|---:|---:|---:|
| GPT-5.5 | 99.25% | 27.95 s | Not exposed | Codex subscription; not convertible |
| GPT-5.6 Terra | 98.67% | 25.17 s | Not exposed | Codex subscription; not convertible |
| **DeepSeek + plugin** | **96.44%** | **6.08 s** | **4,970.8** | **¥0.004521** observed-cache estimate |
| GPT-5.6 Luna | 94.99% | 27.48 s | Not exposed | Codex subscription; not convertible |
| DeepSeek direct image | 19.68% | 6.87 s | 1,135.5 | ¥0.001830 estimate |

For this task, tiling increased the estimated DeepSeek charge per call by about 2.47×, but reduced estimated cost per 100 correct codes by about 51%. DeepSeek's experimental vision model has no separate public price row, so these values use the published V4 Flash rates and are estimates, not invoices. Codex does not expose per-task vision tokens or billable API cost here, so GPT prices are intentionally not guessed.

### Does the per-image token cap reduce reading quality?

It can, especially when a large image contains small, low-contrast, or tightly packed text. In the controlled test, the model and prompt stayed the same while the input changed from one scaled image to complete local tiles; F1 rose from 19.68% to 96.44%. Those runs used the 384-token v4 model, so the comparison is evidence for that workload under that accounting, not a measurement of the current 1024-token cap. It is not a claim that every image needs tiling.

## How it works

1. Decode PNG/JPEG/BMP/GIF/TIFF with Jimp and WebP with bundled WASM.
2. Apply EXIF orientation and reject images above the 100-million-pixel safety limit.
3. Generate a downscaled overview.
4. Plan overlapping tiles whose union covers the full oriented source.
5. In adaptive document mode, move seams toward low-density rows and select optional dense details.
6. Audit coverage, encode PNG attachments, and return bounded batches with coordinates.

The plugin guarantees geometric pixel coverage. It cannot guarantee that a model semantically recognises every visible character; blurred input, compression artefacts, unusual fonts, and model errors still require review.

## Evidence and reproducibility

- [v2 technical report](docs/DSH视觉分块插件v2技术报告.md)
- [Five-model dense-text report](docs/密集文字识别五模型补充报告.md)
- [Dense-text raw matrix](benchmarks/dense-text-matrix.json)
- [Five-model raw matrix](benchmarks/five-model-matrix.json)
- [Experiment runner](experiment/README.md)

The public repository contains aggregate results and reproducible generators, but never API keys or local caches.

## Development

```shell
npm install
npm test
npm pack
```

The test suite covers exact geometric coverage, seam overlap, safety caps, deterministic batching, adaptive detail selection, WebP/WASM decoding, EXIF orientation, and DSH tool rendering. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT
