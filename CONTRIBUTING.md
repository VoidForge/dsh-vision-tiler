# Contributing

Issues and focused pull requests are welcome.

1. Use Node.js 22 or later.
2. Run `npm install` and `npm test` before opening a pull request.
3. Keep geometric coverage fail-closed: no strategy may replace or remove base coverage tiles unless the coverage audit remains exactly 100%.
4. Add a regression test for every bug fix or new image format.
5. Do not commit API keys, downloaded datasets, generated model answers, or local DSH profiles.

For benchmark changes, include the dataset identity, number of independent pages, number of repeated calls, scoring rule, latency definition, token source, and pricing assumptions. Do not infer GPT token or price values when the platform does not expose them.
