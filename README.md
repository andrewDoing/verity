# Verity Trace Review

Desktop app for inspecting agent execution traces, comparing inference outputs against ground truth, reviewing evaluation results, and saving review annotations back to JSON artifacts.

## Prerequisites

- Node.js 22 or newer
- npm
- Local trace, ground-truth, and eval JSON artifacts to review

## Getting started

Install dependencies:

```bash
npm ci
```

Start the Electron app in development mode:

```bash
npm run dev
```

The app loads a review profile from `profiles/inference-review-profile.json` and reads local JSON artifacts from paths you provide in the UI. Local inference runs are expected under `inference/<run-id>/` when using the built-in default paths, but inference artifacts are intentionally not included in the public repository.

## Artifact layout

For the built-in inference review profile, a run folder contains paired trace and eval files:

```text
inference/<run-id>/
  <case-ref>-<iteration>.json
  <case-ref>-<iteration>.eval.json
  manifest.json
```

Example file names are `a00-0.json` and `a00-0.eval.json`. Keep these artifacts local; `inference/`, generated `*.reviewed.json` files, and local planning artifacts are ignored by git.

## Useful commands

```bash
npm run typecheck
npm run test
npm run build
npm run e2e
```

`npm run dogfood` exercises the review workflow against local inference artifacts and writes reviewed output only to a temporary directory.

## Project structure

- `src/main/` - Electron main-process IO, normalization, search, run overview, and patching services
- `src/preload/` - typed bridge between Electron and the renderer
- `src/renderer/` - Preact review UI
- `src/shared/` - shared domain and API types
- `profiles/` and `schemas/` - review profile configuration and JSON schemas
- `tests/` - Vitest unit tests and Playwright Electron E2E tests
