# Changelog

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
