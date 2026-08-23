# Experiment

The experiment uses a small public subset of the ICDAR 2019 SROIE scanned-receipt OCR dataset. It compares the same OCR engine under two input conditions:

1. Whole image scaled to at most 640,000 pixels, approximating DeepSeek's documented `800×800`-equivalent preprocessing.
2. The plugin's 768-pixel overlapping tiles, with no uncovered source pixels.

This isolates the resolution effect while holding the recognition engine constant. It is a proxy experiment, not a DeepSeek accuracy benchmark. A true DeepSeek benchmark requires `DEEPSEEK_API_KEY` and repeated API calls under a pinned model version.

Run:

```powershell
npm run experiment -- --data-dir <path-to-DocumentVQA> --limit 12
```

Raw data, generated tiles, the Tesseract language model, and detailed results remain under the D-drive data directory.
