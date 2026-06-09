import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('loads, searches, annotates, patches, and reloads a dogfood inference artifact', async () => {
  const app = await electron.launch({ args: ['.'] });
  const page = await app.firstWindow();
  const tempDir = await mkdtemp(join(tmpdir(), 'verity-e2e-'));
  const traceInput = page.getByTestId('trace-path');
  const originalTrace = await traceInput.inputValue();
  const reviewedTrace = join(tempDir, 'a00-0.reviewed.json');

  await expect(page.getByTestId('project-summary')).toContainText('trace records');
  await expect(page.getByTestId('trace-list')).toContainText('tool-call');

  // Iteration navigator: flip through inference iterations for a ground-truth case.
  await expect(page.getByTestId('iteration-navigator')).toBeVisible();
  await expect(page.getByTestId('iter-current')).toContainText('a00-0');
  await page.getByTestId('iter-next').click();
  await expect(page.getByTestId('iter-current')).toContainText('a00-1');
  await expect(page.getByTestId('iter-cell-a00-1')).toHaveClass(/active/);
  await page.getByTestId('iter-prev').click();
  await expect(page.getByTestId('iter-current')).toContainText('a00-0');
  await page.getByTestId('iter-cell-a00-2').click();
  await expect(page.getByTestId('iter-current')).toContainText('a00-2');
  await expect(page.getByTestId('trace-path')).toHaveValue(/a00-2\.json$/);

  // Compare mode: pin iterations side by side and tile up to four panels.
  await page.getByTestId('mode-compare').click();
  await expect(page.getByTestId('compare-grid')).toBeVisible();
  await expect(page.locator('[data-testid^="compare-tile-"]')).toHaveCount(2);
  await expect(page.getByTestId('compare-grid')).toHaveClass(/tiles-2/);
  await page.locator('[data-testid^="compare-iter-"]').first().selectOption('5');
  await expect(page.getByTestId('compare-add')).toBeEnabled();
  await page.getByTestId('compare-add').click();
  await page.getByTestId('compare-add').click();
  await expect(page.locator('[data-testid^="compare-tile-"]')).toHaveCount(4);
  await expect(page.getByTestId('compare-grid')).toHaveClass(/tiles-4/);
  await expect(page.getByTestId('compare-add')).toBeDisabled();
  await page.locator('[data-testid^="compare-close-"]').first().click();
  await expect(page.locator('[data-testid^="compare-tile-"]')).toHaveCount(3);
  // Multi-turn cases (c00/d00) must render their answer text under a turn-labeled group.
  const firstTile = page.locator('[data-testid^="compare-tile-"]').first();
  await firstTile.locator('[data-testid^="compare-case-"]').selectOption('c00');
  await expect(firstTile.locator('.compare-pair').first()).toContainText('Dracula');
  await expect(firstTile.locator('.compare-turn-badge').first()).toHaveText('Turn 1');
  await page.getByTestId('mode-trace').click();
  await expect(page.getByTestId('trace-list')).toContainText('tool-call');

  await page.getByTestId('mode-gt').click();
  await expect(page.getByTestId('gt-mode')).toContainText('Ground truth');
  await expect(page.getByTestId('gt-mode')).toContainText('Dracula');

  await page.getByTestId('mode-eval').click();
  await expect(page.getByTestId('eval-mode')).toContainText('generation accuracy');

  await page.getByTestId('search-button').click();
  await expect(page.getByTestId('search-results')).toContainText('Dracula');
  await page.getByTestId('search-filter-trace').click();
  await expect(page.getByTestId('search-result-0')).toContainText('trace ·');
  await page.getByTestId('search-filter-groundTruth').click();
  await expect(page.getByTestId('search-result-0')).toContainText('groundTruth ·');
  await page.getByTestId('search-filter-eval').click();
  await expect(page.getByTestId('search-result-0')).toContainText('eval ·');
  await page.getByTestId('search-filter-all').click();

  await page.getByTestId('mode-gt').click();
  await page.getByLabel('Search indexed artifacts').fill('generation_accuracy');
  await page.getByTestId('search-button').click();
  await expect(page.getByTestId('search-results')).toContainText('Evaluation metrics');
  await page.getByTestId('search-result-0').click();
  await expect(page.getByTestId('mode-eval')).toHaveClass(/active/);
  await expect(page.getByTestId('eval-mode')).toContainText('generation accuracy');

  await page.getByTestId('mode-trace').click();
  await page.getByTestId('annotation-output-path').fill(reviewedTrace);
  await page.getByTestId('annotate-trace').first().click();
  await page.getByTestId('annotation-body').fill('Patched by Playwright E2E.');
  await page.getByTestId('save-annotation').click();
  await expect(page.getByTestId('annotation-status')).toContainText('Saved 1 annotation');
  await expect(page.getByTestId('annotation-list')).toContainText('Patched by Playwright E2E.');
  await expect(page.getByTestId('inline-notes').first()).toContainText('Patched by Playwright E2E.');

  expect(reviewedTrace).not.toBe(originalTrace);
  await page.getByTestId('trace-path').fill(reviewedTrace);
  await page.getByTestId('load-project').click();
  await expect(page.getByTestId('annotation-list')).toContainText('Patched by Playwright E2E.');

  await app.close();
});
