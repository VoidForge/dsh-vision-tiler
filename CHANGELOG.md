# Changelog

## 0.3.0 — 2026-11-27

- Add a settings page on the Plugins bundle page. Every tiling option is live: a save applies to the next `segment_image` call without restarting the plugin. The browser half is bundled with esbuild and keeps its copy in `locale/en.json` and `locale/zh.json`.
- Add a `models` option, exposed in the plugin settings through the new `Config` schema: a list of model id prefixes the tool is offered for. `segment_image` is hidden for every other model, so providers with their own image pipeline are left alone.
- Price every image with DSH's own DeepSeek accounting (`deepSeekImageTokens`, `deepSeekRequestImageDimensions`) from `@deepseek-ai/dsh-llm-deepseek`, replacing the previous 384-token constant.
- Check at plugin load that `@deepseek-ai/dsh-llm-deepseek` still exports the accounting functions this plugin calls. A DSH release that moves or renames them fails the plugin row with a visible warning; the arithmetic itself is DSH's.
- Report `batch.estimatedVisionTokens` and `batch.visionTokenCap`; remove `batch.estimatedVisionTokenCap`.
- Reject a coverage tile or detail crop that DSH or the provider would resize, and reject `overviewMaxEdge` above the 4096 px per-side request limit or when it is not a positive integer.
- Apply the 4096 px per-side request cap when pricing an image, and price the batch from the saved attachment dimensions so the estimate matches what DSH sends after normalization.
- `PreparedImage` now carries `width` and `height`; `PreparedImageBatch` no longer carries `estimatedVisionTokenCap`.
- Require DeepSeek Harness 0.2.2-rc.5 or later.
- Set the model list input box to Consolas, falling back to DSH's code font, so a zh-CN renderer draws model ids instead of NSimSun.

## 0.2.3 — 2026-08-23

- Replace native `sharp` processing with Jimp, EXIF parsing, and bundled WebP WASM to avoid DSH Web native-library conflicts.
- Add a 100-million-pixel decoded-image safety limit.
- Add automatic WebP/WASM and EXIF orientation regression tests.
- Add bilingual documentation, benchmark visualization, security policy, contribution guide, and CI.
- Rename the public npm package to `dsh-vision-tiler` and add release metadata.

## 0.2.2

- Add adaptive low-density seams and optional dense-region detail crops.
- Add dense-text and five-model benchmark matrices.

## 0.1.0

- Initial complete-coverage image tiler and DSH `segment_image` tool.
