# Verity Trace Review App PRD

## Purpose

Verity Trace Review is a desktop application for visually inspecting agent execution traces, comparing inference outputs against ground truth, reviewing evaluation judge results, annotating findings, and patching reviewed annotations back into source artifacts.

## Users and jobs

- Evaluation engineers need to inspect why an agent succeeded or failed across trace, ground-truth, and judge-result evidence.
- Customer-facing teams need one review workflow that adapts to many customer artifact schemas without rewriting the app.
- Dataset curators need durable annotations that can travel with reviewed artifacts and survive future reloading.

## MVP scope

- Electron + Preact + Vite + TypeScript desktop application.
- Secure Electron process split: main for trusted IO/persistence, preload for typed APIs, renderer for browser-only UI.
- Review Profile meta-schema that references customer schemas and declares mappings for trace, ground-truth, eval, display, search, and patching.
- Filesystem-first artifact loading and saving.
- AJV validation for profiles and artifacts with visible validation errors.
- Trace Mode, GT Mode, and Eval Mode.
- Annotation create/edit/delete workflows with source patching through profile rules.
- SQLite-compatible local metadata and search cache.
- Dogfooding against real artifacts from `inference/`.
- E2E coverage for loading, inspecting, searching, annotating, patching, and reloading.

## Non-goals

- Cloud credentials, remote blob browsing, or blob write-back in the first release.
- Multi-user collaboration, auth, or sync.
- Executable customer adapters in the first release.
- Editing arbitrary customer data beyond Verity review annotations.

## Core workflows

1. Load a Review Profile.
2. Load a trace/inference artifact and optional eval artifact from local files.
3. Validate artifacts against the active profile.
4. Inspect transcript/tool-call records in Trace Mode.
5. Compare inference output against ground truth in GT Mode.
6. Inspect judge metrics and fact-level support in Eval Mode.
7. Search indexed trace, ground-truth, and eval text.
8. Create annotations anchored to JSON Pointer, stable ID when available, content hash, and optional time range.
9. Patch annotations into a reviewed artifact using profile-defined patch strategy.
10. Reload the reviewed artifact and see the saved annotations.

## Data model

- `ReviewProfile` describes artifact roles, schema references, path mappings, search fields, display fields, and patch rules.
- `TraceNode` is the renderer-safe normalized record for prompts, tool calls, outputs, timing, status, and raw JSON pointers.
- `GroundTruthView` describes paired ground-truth and inference fields for comparison.
- `EvalView` describes metric summaries, scores, judge facts, source status, and source links.
- `Annotation` records label, body, tags, timestamps, and a target containing artifact role, JSON Pointer, optional stable ID, content hash, and optional time range.

## Storage model

Source artifacts remain in files or future blob storage. The MVP implements a `file://` StorageConnector and keeps SQLite as a rebuildable local cache for recent projects, artifact metadata, indexed text, JSON Pointers, and search results.

## Annotation patching policy

The default policy is schema-overlay patching. Profiles may choose native field patching, extension field patching, schema-overlay patching, or sidecar fallback. Patch writes must validate the reviewed output when a reviewed schema or overlay is available.

## Verification strategy

The implementation is complete when type checking, unit tests, production build, dogfood workflow, and E2E tests pass. Dogfooding must use at least one real inference run from `inference/` and must patch only temporary copies of artifacts.
