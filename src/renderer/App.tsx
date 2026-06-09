import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import type { Annotation, ArtifactRole, GroundTruthPair, IterationSummary, LoadedProject, RunOverview, RunSummary, SearchHit, TraceNode } from '@shared/domain';
import { stringifyPreview } from '@shared/json';

type Mode = 'trace' | 'gt' | 'eval' | 'compare';
type SearchFilter = 'all' | ArtifactRole;

interface PathsState {
  profilePath: string;
  tracePath: string;
  evalPath: string;
}

const emptyPaths: PathsState = { profilePath: '', tracePath: '', evalPath: '' };

const MODE_LABELS: Record<Mode, string> = { trace: 'Trace', gt: 'Ground Truth', eval: 'Eval', compare: 'Compare' };
const SEARCH_FILTER_LABELS: Record<SearchFilter, string> = { all: 'All', trace: 'Trace', groundTruth: 'GT', eval: 'Eval' };
const SEARCH_FILTERS: SearchFilter[] = ['all', 'trace', 'groundTruth', 'eval'];

const MODE_TARGETS: Record<Mode, string> = {
  trace: '[data-testid="trace-detail"]',
  gt: '[data-testid="gt-mode"]',
  eval: '[data-testid="eval-mode"]',
  compare: '[data-testid="compare-mode"]'
};

function reviewedPath(path: string): string {
  return path.endsWith('.json') ? path.replace(/\.json$/, '.reviewed.json') : `${path}.reviewed.json`;
}

function truncate(value: string, max = 420): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function statusClass(status?: string): 'ok' | 'bad' | '' {
  if (status === 'true' || status === 'pass' || status === 'success') return 'ok';
  if (status === 'false' || status === 'fail' || status === 'error') return 'bad';
  return '';
}

function statusLabel(status?: string): string {
  const cls = statusClass(status);
  if (cls === 'ok') return 'pass';
  if (cls === 'bad') return 'fail';
  return status ?? 'n/a';
}

function scrollModeIntoView(mode: Mode): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(MODE_TARGETS[mode])?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

/** Render any value as readable text: strings as-is, objects pretty-printed. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  if (value === null) return 'null';
  return JSON.stringify(value, null, 2);
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-block">{truncate(stringifyPreview(value), 2400)}</pre>;
}

/* ----------------------------- Word-level diff ----------------------------- */

type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

function tokenize(input: string): string[] {
  return input.match(/\s+|[^\s]+/g) ?? [];
}

/** LCS-based word diff producing aligned ops for ground-truth vs inference. */
function diffWords(before: string, after: string): DiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffOp['type'], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('del', a[i]);
      i += 1;
    } else {
      push('add', b[j]);
      j += 1;
    }
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('add', b[j++]);
  return ops;
}

function DiffView({ ops, side }: { ops: DiffOp[]; side: 'before' | 'after' }) {
  const keep = side === 'before' ? 'del' : 'add';
  return (
    <p className="diff-text">
      {ops
        .filter((op) => op.type === 'same' || op.type === keep)
        .map((op, index) =>
          op.type === 'same' ? (
            <span key={index}>{op.text}</span>
          ) : (
            <span key={index} className={side === 'before' ? 'diff-del' : 'diff-add'}>
              {op.text}
            </span>
          )
        )}
    </p>
  );
}

function Chip({ kind, children }: { kind?: 'pass' | 'fail' | 'warn' | 'accent'; children: ComponentChildren }) {
  return <span className={`chip ${kind ?? ''}`}>{children}</span>;
}

/* ----------------------- Inline annotation system ------------------------- */

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

interface AnnotationTargetInput {
  pointer: string;
  role: ArtifactRole;
  label: string;
}

interface AnnotationContextValue {
  byPointer: Map<string, Annotation[]>;
  openKey: string | null;
  status: string;
  saving: boolean;
  /** Build a stable identity for a target so each block tracks its own composer. */
  keyOf(target: AnnotationTargetInput): string;
  open(target: AnnotationTargetInput): void;
  close(): void;
  save(target: AnnotationTargetInput, body: string): Promise<void>;
}

const AnnotationContext = createContext<AnnotationContextValue | null>(null);

function useAnnotation(): AnnotationContextValue {
  const ctx = useContext(AnnotationContext);
  if (!ctx) throw new Error('useAnnotation must be used within an AnnotationProvider');
  return ctx;
}

function targetKey(target: AnnotationTargetInput): string {
  return `${target.role}:${target.pointer}`;
}

/** Floating composer anchored under the block's annotate trigger. */
function InlineComposer({ target }: { target: AnnotationTargetInput }) {
  const ctx = useAnnotation();
  const [body, setBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const node = event.target as Node | null;
      if (!node) return;
      if (rootRef.current?.contains(node)) return;
      if (node instanceof Element && node.closest('.annotate-trigger')) return;
      ctx.close();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [ctx]);

  const submit = useCallback(() => {
    if (!body.trim() || ctx.saving) return;
    void ctx.save(target, body.trim());
  }, [body, ctx, target]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      ctx.close();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div ref={rootRef} className="inline-composer" data-testid="inline-composer" onClick={(event) => event.stopPropagation()}>
      <div className="inline-composer-head">
        <span className="inline-composer-target">{target.label}</span>
        <button type="button" className="icon-button" onClick={ctx.close} aria-label="Cancel annotation">✕</button>
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        onInput={(event) => setBody(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        placeholder="Add a review note…"
        data-testid="annotation-body"
        aria-label={`Annotation note for ${target.label}`}
      />
      <div className="inline-composer-foot">
        <span className="inline-composer-hint">⌘⏎ to save · Esc to cancel</span>
        <div className="inline-composer-actions">
          <button type="button" className="ghost" onClick={ctx.close}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!body.trim() || ctx.saving} data-testid="save-annotation">
            {ctx.saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Existing notes shown inline beneath an annotated block. */
function InlineNotes({ notes }: { notes: Annotation[] }) {
  return (
    <div className="inline-notes" data-testid="inline-notes">
      {notes.map((note) => (
        <div className="inline-note" key={note.id}>
          <PencilIcon />
          <div>
            {note.body ? <p>{note.body}</p> : null}
            <span className="inline-note-meta">{note.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Wraps any viewer block to make it annotatable inline: a hover-revealed trigger,
 * an on-block highlight when notes exist, the note thread, and an anchored composer.
 */
function Annotatable({
  pointer,
  role,
  label,
  className,
  children
}: {
  pointer: string;
  role: ArtifactRole;
  label: string;
  className?: string;
  children: ComponentChildren;
}) {
  const ctx = useAnnotation();
  const target: AnnotationTargetInput = { pointer, role, label };
  const key = ctx.keyOf(target);
  const notes = ctx.byPointer.get(pointer) ?? [];
  const isOpen = ctx.openKey === key;

  return (
    <div
      className={`annotatable ${notes.length ? 'has-notes' : ''} ${isOpen ? 'is-open' : ''} ${className ?? ''}`}
      data-annotation-key={key}
    >
      <button
        type="button"
        className="annotate-trigger"
        data-testid={`annotate-${role}`}
        aria-label={notes.length ? `${notes.length} note(s) on ${label} — add another` : `Annotate ${label}`}
        onClick={() => (isOpen ? ctx.close() : ctx.open(target))}
      >
        <PencilIcon />
        <span>{notes.length ? notes.length : 'Annotate'}</span>
      </button>
      {children}
      {notes.length > 0 ? <InlineNotes notes={notes} /> : null}
      {isOpen ? <InlineComposer target={target} /> : null}
    </div>
  );
}

/* --------------------------------- Trace ---------------------------------- */

function TraceRow({ node, selected, onSelect }: { node: TraceNode; selected: boolean; onSelect: (node: TraceNode) => void }) {
  const cls = statusClass(node.status);
  return (
    <button
      className={`trace-row ${cls} ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(node)}
      data-testid={`trace-row-${node.kind}`}
    >
      <span className="kind-badge">{node.kind}</span>
      <span className="trace-label">{node.label || node.kind}</span>
      <span className="trace-status">
        <Chip kind={cls === 'ok' ? 'pass' : cls === 'bad' ? 'fail' : undefined}>{statusLabel(node.status)}</Chip>
      </span>
      <span className="trace-time">{node.durationMs ?? 0} ms</span>
    </button>
  );
}

function TraceMode({ project, selectedNode, onSelectNode }: { project: LoadedProject; selectedNode?: TraceNode; onSelectNode: (node: TraceNode) => void }) {
  const active = selectedNode ?? project.traceNodes[0];
  const cls = statusClass(active?.status);
  return (
    <div className="work-grid">
      <section className="panel timeline-panel">
        <div className="panel-title">
          <span>Trace sequence</span>
          <Chip>{project.traceNodes.length} records</Chip>
        </div>
        <div className="trace-list" data-testid="trace-list">
          {project.traceNodes.map((node) => (
            <TraceRow key={node.id} node={node} selected={active?.id === node.id} onSelect={onSelectNode} />
          ))}
        </div>
      </section>
      <section className="panel detail-panel" data-testid="trace-detail">
        <div className="panel-title">Selected record</div>
        {active ? (
          <>
            <div className="detail-head">
              <div>
                <div className="detail-kicker">{active.rawPointer}</div>
                <h2>{active.label || active.kind}</h2>
              </div>
              <Chip kind={cls === 'ok' ? 'pass' : cls === 'bad' ? 'fail' : undefined}>{statusLabel(active.status)}</Chip>
            </div>
            <div className="detail-grid">
              <span>Kind</span>
              <strong>{active.kind}</strong>
              <span>Status</span>
              <strong>{statusLabel(active.status)}</strong>
              <span>Elapsed</span>
              <strong>{active.durationMs ?? 0} ms</strong>
            </div>
            {active.details.map((detail) => (
              <Annotatable key={detail.pointer} pointer={detail.pointer} role="trace" label={detail.label} className="detail-card-wrap">
                <article className="detail-card">
                  <h3>{detail.label}</h3>
                  <JsonBlock value={detail.value} />
                </article>
              </Annotatable>
            ))}
            <Annotatable pointer={active.rawPointer} role="trace" label={`${active.label || active.kind} · raw`} className="detail-card-wrap">
              <article className="detail-card">
                <h3>Raw JSON</h3>
                <JsonBlock value={active.attributes} />
              </article>
            </Annotatable>
          </>
        ) : (
          <div className="empty-state">No trace records found for the active profile mapping.</div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ Ground truth ------------------------------ */

/** Group ground-truth pairs by conversation turn; single-turn records yield one untitled group. */
function groupPairsByTurn(pairs: GroundTruthPair[]): Array<{ turn?: number; pairs: GroundTruthPair[] }> {
  const groups: Array<{ turn?: number; pairs: GroundTruthPair[] }> = [];
  for (const pair of pairs) {
    const last = groups[groups.length - 1];
    if (last && last.turn === pair.turn) last.pairs.push(pair);
    else groups.push({ turn: pair.turn, pairs: [pair] });
  }
  return groups;
}

function GtMode({ project }: { project: LoadedProject }) {
  return (
    <section className="panel comparison-panel" data-testid="gt-mode">
      <div className="panel-title">
        <span>Ground truth comparison</span>
        <Chip kind="accent">word-level diff</Chip>
      </div>
      <p className="section-note">Highlights show where the inference diverges from ground truth — removed text in red, added text in green.</p>
      {groupPairsByTurn(project.groundTruthPairs).map((group) => (
        <div className="turn-group" key={group.turn ?? 'single'} data-testid={group.turn === undefined ? undefined : `gt-turn-${group.turn}`}>
          {group.turn !== undefined ? (
            <div className="turn-divider"><span className="turn-badge">Turn {group.turn + 1}</span></div>
          ) : null}
          {group.pairs.map((pair) => {
            const beforeText = asText(pair.groundTruth);
            const afterText = asText(pair.inference);
            const ops = diffWords(beforeText, afterText);
            const matches = !ops.some((op) => op.type !== 'same');
            return (
              <Annotatable key={pair.inferencePointer} pointer={pair.inferencePointer} role="groundTruth" label={pair.label} className="comparison-wrap">
                <article className="comparison-row">
                  <div className="row-meta">
                    <h3>{pair.label}</h3>
                    <Chip kind={matches ? 'pass' : 'fail'}>{matches ? 'exact match' : 'differs'}</Chip>
                    <div className="detail-kicker">{pair.groundTruthPointer} ⇄ {pair.inferencePointer}</div>
                  </div>
                  <div className="compare-card">
                    <div className="col-head">Ground truth</div>
                    <DiffView ops={ops} side="before" />
                  </div>
                  <div className="compare-card inference">
                    <div className="col-head">Inference</div>
                    <DiffView ops={ops} side="after" />
                  </div>
                </article>
              </Annotatable>
            );
          })}
        </div>
      ))}
    </section>
  );
}

/* ---------------------------------- Eval ---------------------------------- */

function metricTone(score: number): 'good' | 'mid' | 'low' {
  if (score >= 0.9) return 'good';
  if (score >= 0.7) return 'mid';
  return 'low';
}

function EvalMetricCard({ metric }: { metric: LoadedProject['evalMetrics'][number] }) {
  if (typeof metric.score === 'number') {
    const tone = metricTone(metric.score);
    return (
      <article className={`metric-card ${tone}`}>
        <span className="metric-name">{metric.name.replaceAll('_', ' ')}</span>
        <strong>{metric.score.toFixed(3)}</strong>
        <div className="metric-bar">
          <i style={{ width: `${Math.max(0, Math.min(1, metric.score)) * 100}%` }} />
        </div>
        <small>{metric.pointer}</small>
      </article>
    );
  }
  if (typeof metric.numerator === 'number' && typeof metric.denominator === 'number') {
    const ratio = metric.denominator ? metric.numerator / metric.denominator : 0;
    const tone = metricTone(ratio);
    return (
      <article className={`metric-card ${tone}`}>
        <span className="metric-name">{metric.name.replaceAll('_', ' ')}</span>
        <strong>{metric.numerator}/{metric.denominator}</strong>
        <div className="metric-bar">
          <i style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
        </div>
        <small>{metric.pointer}</small>
      </article>
    );
  }
  return (
    <article className="metric-card neutral">
      <span className="metric-name">{metric.name.replaceAll('_', ' ')}</span>
      <strong>recorded</strong>
      <small>{metric.pointer}</small>
    </article>
  );
}

function factSupport(fact: unknown): { text: string; id?: string; supported?: boolean } {
  if (fact && typeof fact === 'object') {
    const record = fact as Record<string, unknown>;
    const supported =
      typeof record.supported_by_inference === 'boolean'
        ? record.supported_by_inference
        : typeof record.supported_by_ground_truth === 'boolean'
          ? record.supported_by_ground_truth
          : undefined;
    return {
      text: typeof record.fact === 'string' ? record.fact : asText(fact),
      id: typeof record.id === 'string' ? record.id : undefined,
      supported
    };
  }
  return { text: asText(fact) };
}

function EvalMode({ project }: { project: LoadedProject }) {
  return (
    <div className="eval-grid" data-testid="eval-mode">
      <section className="panel">
        <div className="panel-title">
          <span>Judge metrics</span>
          {project.evalStatus ? <Chip kind="accent">{project.evalStatus}</Chip> : null}
        </div>
        <div className="metric-grid">
          {project.evalMetrics.map((metric) => (
            <Annotatable key={metric.pointer} pointer={metric.pointer} role="eval" label={metric.name.replaceAll('_', ' ')} className="metric-wrap">
              <EvalMetricCard metric={metric} />
            </Annotatable>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">Fact support</div>
        <p className="section-note">Unsupported facts are review hotspots — claims a judge could not corroborate.</p>
        {project.evalFactGroups.map((group) => {
          const facts = group.facts.map(factSupport);
          const unsupported = facts.filter((f) => f.supported === false).length;
          return (
            <Annotatable key={group.pointer} pointer={group.pointer} role="eval" label={group.label} className="fact-group-wrap">
              <article className="fact-group">
                <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{group.label}</span>
                  {unsupported > 0 ? <Chip kind="fail">{unsupported} unsupported</Chip> : <Chip kind="pass">all supported</Chip>}
                </h3>
                {facts.map((fact, index) => (
                  <div
                    className={`fact-row ${fact.supported === false ? 'unsupported' : fact.supported === true ? 'supported' : ''}`}
                    key={index}
                  >
                    {fact.supported === undefined ? (
                      <Chip>fact</Chip>
                    ) : (
                      <Chip kind={fact.supported ? 'pass' : 'fail'}>{fact.supported ? 'supported' : 'unsupported'}</Chip>
                    )}
                    <div>
                      <p>{fact.text}</p>
                      {fact.id ? <div className="fact-id">{fact.id}</div> : null}
                    </div>
                  </div>
                ))}
              </article>
            </Annotatable>
          );
        })}
      </section>
    </div>
  );
}

/* -------------------------------- Search ---------------------------------- */

function SearchPanel({
  hits,
  onSearch,
  onSelectHit
}: {
  hits: SearchHit[];
  onSearch: (query: string) => void;
  onSelectHit: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState('Dracula');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const filteredHits = useMemo(() => (filter === 'all' ? hits : hits.filter((hit) => hit.artifactRole === filter)), [filter, hits]);
  const roleCounts = useMemo(
    () => ({
      all: hits.length,
      trace: hits.filter((hit) => hit.artifactRole === 'trace').length,
      groundTruth: hits.filter((hit) => hit.artifactRole === 'groundTruth').length,
      eval: hits.filter((hit) => hit.artifactRole === 'eval').length
    }),
    [hits]
  );

  return (
    <section className="panel search-panel">
      <div className="panel-title">
        <span>Search artifacts</span>
        <Chip>{filteredHits.length}/{hits.length}</Chip>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(query);
        }}
      >
        <input value={query} onInput={(event) => setQuery(event.currentTarget.value)} aria-label="Search indexed artifacts" placeholder="Search trace + eval…" />
        <button type="submit" data-testid="search-button">Search</button>
      </form>
      <div className="search-filters" role="group" aria-label="Filter search results by artifact type">
        {SEARCH_FILTERS.map((item) => (
          <button
            type="button"
            key={item}
            className={filter === item ? 'active' : ''}
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
            data-testid={`search-filter-${item}`}
          >
            {SEARCH_FILTER_LABELS[item]}
            <span>{roleCounts[item]}</span>
          </button>
        ))}
      </div>
      <div className="search-results" data-testid="search-results">
        {filteredHits.map((hit, index) => (
          <button
            className="search-hit"
            key={`${hit.artifactRole}:${hit.pointer}`}
            type="button"
            onClick={() => onSelectHit(hit)}
            data-testid={`search-result-${index}`}
            aria-label={`Open ${hit.label} at ${hit.pointer}`}
          >
            <strong>{hit.label}</strong>
            <span>{hit.artifactRole} · {hit.pointer}</span>
            <p>{truncate(hit.preview, 220)}</p>
          </button>
        ))}
        {filteredHits.length === 0 ? <div className="empty-state">No matches for this filter.</div> : null}
      </div>
    </section>
  );
}

/* --------------------------- Review session index ------------------------- */

function ReviewSessionPanel({
  project,
  outputPath,
  onOutputPathChange,
  status
}: {
  project?: LoadedProject;
  outputPath: string;
  onOutputPathChange: (value: string) => void;
  status: string;
}) {
  const annotations = project?.annotations ?? [];

  function focusAnnotation(annotation: Annotation): void {
    const key = `${annotation.target.artifactRole}:${annotation.target.jsonPointer}`;
    const el = document.querySelector<HTMLElement>(`[data-annotation-key="${CSS.escape(key)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.classList.add('flash');
    window.setTimeout(() => el?.classList.remove('flash'), 1200);
  }

  return (
    <section className="panel review-session">
      <div className="panel-title">
        <span>Review session</span>
        <Chip>{annotations.length}</Chip>
      </div>
      <p className="section-note">Annotate inline from any record, comparison, or fact. Notes patch into the reviewed artifact.</p>
      <label className="field">
        Reviewed output path
        <input
          value={outputPath}
          onInput={(event) => onOutputPathChange(event.currentTarget.value)}
          data-testid="annotation-output-path"
          aria-label="Reviewed output path"
        />
      </label>
      <div className="annotation-status" data-testid="annotation-status">{status}</div>
      <div className="annotation-list" data-testid="annotation-list">
        {annotations.length === 0 ? (
          <div className="empty-state compact">No annotations yet. Hover a block and click Annotate.</div>
        ) : (
          annotations.map((annotation) => (
            <button type="button" className="annotation-index" key={annotation.id} onClick={() => focusAnnotation(annotation)}>
              <strong>{annotation.label}</strong>
              <span>{annotation.target.artifactRole} · {annotation.target.jsonPointer}</span>
              {annotation.body ? <p>{annotation.body}</p> : null}
            </button>
          ))
        )}
      </div>
    </section>
  );
}

/* --------------------------- Iteration navigator -------------------------- */

function scorePct(score: number): number {
  return Math.round(score * 100);
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

/**
 * Drives which inference iteration feeds the Trace/GT/Eval views. Groups iterations by
 * ground-truth case, lets the reviewer flip through them (click / prev-next / arrow keys),
 * and color-codes a score strip so the best and worst iterations stand out for review.
 */
function IterationNavigator({
  run,
  activeRef,
  activeIter,
  onSelectIteration
}: {
  run: RunOverview;
  activeRef: string;
  activeIter: number;
  onSelectIteration: (iteration: IterationSummary) => void;
}) {
  const [sortByScore, setSortByScore] = useState(false);

  const activeCase = useMemo(
    () => run.cases.find((item) => item.ref === activeRef) ?? run.cases[0],
    [run.cases, activeRef]
  );

  const scored = useMemo(() => activeCase?.iterations.filter((it) => typeof it.score === 'number') ?? [], [activeCase]);
  const best = useMemo(() => (scored.length ? scored.reduce((a, b) => (b.score! > a.score! ? b : a)) : undefined), [scored]);
  const worst = useMemo(() => (scored.length ? scored.reduce((a, b) => (b.score! < a.score! ? b : a)) : undefined), [scored]);
  const meanScore = useMemo(
    () => (scored.length ? scored.reduce((total, it) => total + it.score!, 0) / scored.length : undefined),
    [scored]
  );

  const ordered = useMemo(() => {
    const list = activeCase?.iterations ?? [];
    if (!sortByScore) return list;
    return [...list].sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
  }, [activeCase, sortByScore]);

  const activeIteration = useMemo(
    () => activeCase?.iterations.find((it) => it.iteration === activeIter) ?? activeCase?.iterations[0],
    [activeCase, activeIter]
  );

  const flip = useCallback(
    (delta: number) => {
      const list = activeCase?.iterations ?? [];
      if (list.length === 0) return;
      const currentIndex = Math.max(0, list.findIndex((it) => it.iteration === activeIter));
      const next = list[(currentIndex + delta + list.length) % list.length];
      if (next) onSelectIteration(next);
    },
    [activeCase, activeIter, onSelectIteration]
  );

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      flip(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      flip(-1);
    }
  }

  if (!activeCase) return null;
  const position = Math.max(0, activeCase.iterations.findIndex((it) => it.iteration === activeIter)) + 1;

  return (
    <section
      className="panel iteration-navigator"
      data-testid="iteration-navigator"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Inference iteration navigator"
    >
      <div className="panel-title">
        <span>Iterations · run {run.runFolder}</span>
        <Chip>{run.cases.length} ground-truth cases</Chip>
      </div>

      <div className="iter-cases" role="tablist" aria-label="Ground-truth cases">
        {run.cases.map((item) => {
          const caseScored = item.iterations.filter((it) => typeof it.score === 'number');
          const caseMean = caseScored.length ? caseScored.reduce((t, it) => t + it.score!, 0) / caseScored.length : undefined;
          return (
            <button
              type="button"
              key={item.ref}
              role="tab"
              aria-selected={item.ref === activeRef}
              className={`iter-case ${item.ref === activeRef ? 'active' : ''}`}
              data-testid={`iter-case-${item.ref}`}
              onClick={() => onSelectIteration(item.iterations[0])}
            >
              <span className="iter-case-ref">{item.ref}</span>
              <span className="iter-case-meta">
                {item.iterations.length}×{caseMean !== undefined ? ` · ${scorePct(caseMean)}%` : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div className="iter-controls">
        <button type="button" className="iter-step" onClick={() => flip(-1)} data-testid="iter-prev" aria-label="Previous iteration">
          <ChevronLeft />
        </button>
        <div className="iter-current" data-testid="iter-current">
          <strong>{activeIteration?.label ?? activeRef}</strong>
          <span>iteration {position} of {activeCase.iterations.length}</span>
        </div>
        <button type="button" className="iter-step" onClick={() => flip(1)} data-testid="iter-next" aria-label="Next iteration">
          <ChevronRight />
        </button>
        <div className="iter-spread">
          {meanScore !== undefined ? <Chip kind="accent">mean {scorePct(meanScore)}%</Chip> : null}
          {best && worst && best.iteration !== worst.iteration ? (
            <>
              <Chip kind="pass">best {best.label.split('-')[1]} · {scorePct(best.score!)}%</Chip>
              <Chip kind="fail">worst {worst.label.split('-')[1]} · {scorePct(worst.score!)}%</Chip>
            </>
          ) : null}
          {activeCase.iterations.length > 1 ? (
            <button
              type="button"
              className={`iter-sort ${sortByScore ? 'active' : ''}`}
              onClick={() => setSortByScore((value) => !value)}
              aria-pressed={sortByScore}
              data-testid="iter-sort"
            >
              {sortByScore ? 'By score ↑' : 'By order'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="iter-strip" data-testid="iter-strip">
        {ordered.map((it) => {
          const hasScore = typeof it.score === 'number';
          const tone = hasScore ? metricTone(it.score!) : 'neutral';
          const isActive = it.iteration === activeIter;
          const flag = it.unsupportedFacts ?? 0;
          const isBest = !!best && it.iteration === best.iteration;
          const isWorst = !!best && !!worst && worst.iteration !== best.iteration && it.iteration === worst.iteration;
          const tag = isBest ? 'best' : isWorst ? 'worst' : '';
          return (
            <button
              type="button"
              key={it.label}
              className={`iter-cell tone-${tone} ${isActive ? 'active' : ''} ${isBest ? 'is-best' : ''} ${isWorst ? 'is-worst' : ''}`}
              data-testid={`iter-cell-${it.label}`}
              aria-label={`${it.label}${hasScore ? ` score ${scorePct(it.score!)} percent` : ' no eval'}${tag ? `, ${tag} of case` : ''}${flag ? `, ${flag} unsupported facts` : ''}`}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onSelectIteration(it)}
            >
              <span className="iter-cell-top">
                <span className="iter-cell-idx">#{it.iteration}</span>
                {flag > 0 ? <span className="iter-cell-flag" title={`${flag} unsupported fact(s)`}>{flag}</span> : null}
              </span>
              <span className="iter-cell-score">{hasScore ? `${scorePct(it.score!)}%` : '—'}</span>
              <span className="iter-cell-bar">
                <i style={{ width: `${hasScore ? scorePct(it.score!) : 0}%` }} />
              </span>
              <span className={`iter-cell-tag ${tag}`}>{tag}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------- Compare (tiling) ---------------------------- */

interface CompareSlot {
  id: string;
  runFolder: string;
  runPath: string;
  ref: string;
  iteration: number;
}

let slotSeq = 0;
function nextSlotId(): string {
  slotSeq += 1;
  return `slot-${slotSeq}`;
}

/** Quality-score metrics for a loaded view (drops timing/meta and out-of-range values). */
function scoreMetrics(project: LoadedProject): Array<{ name: string; score: number; pointer: string }> {
  return project.evalMetrics
    .filter((metric) => typeof metric.score === 'number' && metric.score >= 0 && metric.score <= 1 && !metric.name.startsWith('meta_'))
    .map((metric) => ({ name: metric.name, score: metric.score as number, pointer: metric.pointer }));
}

function meanScore(project: LoadedProject): number | undefined {
  const metrics = scoreMetrics(project);
  if (metrics.length === 0) return undefined;
  return metrics.reduce((total, metric) => total + metric.score, 0) / metrics.length;
}

function unsupportedCount(project: LoadedProject): number {
  return project.evalFactGroups.reduce((total, group) => {
    return (
      total +
      group.facts.filter((fact) => {
        if (!fact || typeof fact !== 'object') return false;
        const record = fact as Record<string, unknown>;
        return record.supported_by_inference === false || record.supported_by_ground_truth === false;
      }).length
    );
  }, 0);
}

/** Selector header + comparison body for one tile in the compare grid. */
function CompareTile({
  slot,
  runs,
  overview,
  project,
  canClose,
  onChange,
  onClose
}: {
  slot: CompareSlot;
  runs: RunSummary[];
  overview?: RunOverview;
  project?: LoadedProject;
  canClose: boolean;
  onChange: (next: Partial<Pick<CompareSlot, 'runFolder' | 'runPath' | 'ref' | 'iteration'>>) => void;
  onClose: () => void;
}) {
  const run = runs.find((item) => item.runFolder === slot.runFolder);
  const refs = overview ? overview.cases.map((item) => item.ref) : run?.refs ?? [slot.ref];
  const caseEntry = overview?.cases.find((item) => item.ref === slot.ref);
  const iterations = caseEntry ? caseEntry.iterations.map((it) => it.iteration) : Array.from({ length: run?.iterations ?? slot.iteration + 1 }, (_, i) => i);

  const score = project ? meanScore(project) : undefined;
  const tone = score === undefined ? 'neutral' : metricTone(score);
  const metrics = project ? scoreMetrics(project) : [];
  const unsupported = project ? unsupportedCount(project) : 0;

  return (
    <section className="compare-tile" data-testid={`compare-tile-${slot.id}`}>
      <header className="compare-tile-head">
        <div className="compare-selectors">
          <label className="compare-select" title="Run (model / config permutation)">
            <span>run</span>
            <select
              value={slot.runFolder}
              data-testid={`compare-run-${slot.id}`}
              onChange={(event) => {
                const folder = event.currentTarget.value;
                const target = runs.find((item) => item.runFolder === folder);
                if (target) onChange({ runFolder: folder, runPath: target.runPath, ref: target.refs[0] ?? slot.ref, iteration: 0 });
              }}
            >
              {runs.map((item) => (
                <option key={item.runFolder} value={item.runFolder}>{item.runFolder}</option>
              ))}
            </select>
          </label>
          <label className="compare-select" title="Ground-truth case">
            <span>case</span>
            <select
              value={slot.ref}
              data-testid={`compare-case-${slot.id}`}
              onChange={(event) => onChange({ ref: event.currentTarget.value, iteration: 0 })}
            >
              {refs.map((ref) => (
                <option key={ref} value={ref}>{ref}</option>
              ))}
            </select>
          </label>
          <label className="compare-select" title="Inference iteration">
            <span>iter</span>
            <select
              value={String(slot.iteration)}
              data-testid={`compare-iter-${slot.id}`}
              onChange={(event) => onChange({ iteration: Number(event.currentTarget.value) })}
            >
              {iterations.map((iteration) => (
                <option key={iteration} value={String(iteration)}>{iteration}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="compare-tile-meta">
          {score !== undefined ? <Chip kind={tone === 'good' ? 'pass' : tone === 'low' ? 'fail' : 'warn'}>{scorePct(score)}%</Chip> : null}
          {unsupported > 0 ? <Chip kind="fail">{unsupported} unsupported</Chip> : null}
          {canClose ? (
            <button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${slot.ref}-${slot.iteration} panel`} data-testid={`compare-close-${slot.id}`}>✕</button>
          ) : null}
        </div>
      </header>

      <div className="compare-tile-body">
        {!project ? (
          <div className="empty-state compact">{overview ? `No artifact for ${slot.ref}-${slot.iteration} in this run.` : 'Loading…'}</div>
        ) : (
          <>
            <div className="compare-metrics">
              {metrics.length === 0 ? (
                <span className="compare-metric-empty">No eval metrics</span>
              ) : (
                metrics.map((metric) => {
                  const mTone = metricTone(metric.score);
                  return (
                    <div className={`compare-metric tone-${mTone}`} key={metric.pointer}>
                      <span className="compare-metric-name">{metric.name.replaceAll('_', ' ')}</span>
                      <span className="compare-metric-bar"><i style={{ width: `${scorePct(metric.score)}%` }} /></span>
                      <span className="compare-metric-score">{scorePct(metric.score)}%</span>
                    </div>
                  );
                })
              )}
            </div>
            <div className="compare-pairs">
              {groupPairsByTurn(project.groundTruthPairs).map((group) => (
                <div className="compare-turn" key={group.turn ?? 'single'}>
                  {group.turn !== undefined ? <div className="compare-turn-badge">Turn {group.turn + 1}</div> : null}
                  {group.pairs.map((pair) => {
                    const ops = diffWords(asText(pair.groundTruth), asText(pair.inference));
                    const matches = !ops.some((op) => op.type !== 'same');
                    return (
                      <article className="compare-pair" key={pair.inferencePointer}>
                        <div className="compare-pair-head">
                          <h4>{pair.label}</h4>
                          <Chip kind={matches ? 'pass' : 'fail'}>{matches ? 'match' : 'differs'}</Chip>
                        </div>
                        <DiffView ops={ops} side="after" />
                      </article>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Tiling comparison: pin up to four iterations side by side. Each tile independently selects a
 * run (model/config permutation), ground-truth case, and iteration, so reviewers can scan how
 * outputs diverge across permutations on one screen.
 */
function CompareMode({
  runs,
  profilePath,
  seed
}: {
  runs: RunSummary[];
  profilePath: string;
  seed: CompareSlot;
}) {
  const [slots, setSlots] = useState<CompareSlot[]>(() => {
    const seedRun = runs.find((item) => item.runFolder === seed.runFolder);
    const secondIter = seedRun && seedRun.iterations > 1 ? (seed.iteration + 1) % seedRun.iterations : seed.iteration;
    return [
      { ...seed, id: nextSlotId() },
      { ...seed, id: nextSlotId(), iteration: secondIter }
    ];
  });
  const [overviews, setOverviews] = useState<Record<string, RunOverview>>({});
  const [views, setViews] = useState<Record<string, LoadedProject>>({});

  const runPaths = useMemo(() => [...new Set(slots.map((slot) => slot.runPath))], [slots]);

  useEffect(() => {
    let cancelled = false;
    for (const runPath of runPaths) {
      if (overviews[runPath]) continue;
      void window.verity
        .getRunOverview({ profilePath, tracePath: `${runPath}/__compare__-0.json` })
        .then((overview) => {
          if (!cancelled) setOverviews((prev) => ({ ...prev, [runPath]: overview }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [runPaths, overviews, profilePath]);

  const resolved = slots.map((slot) => {
    const overview = overviews[slot.runPath];
    const iteration = overview?.cases.find((item) => item.ref === slot.ref)?.iterations.find((it) => it.iteration === slot.iteration);
    return { slot, overview, iteration };
  });

  useEffect(() => {
    let cancelled = false;
    for (const { iteration } of resolved) {
      if (!iteration || views[iteration.tracePath]) continue;
      void window.verity
        .loadProjectView({ profilePath, tracePath: iteration.tracePath, evalPath: iteration.evalPath })
        .then((project) => {
          if (!cancelled) setViews((prev) => ({ ...prev, [iteration.tracePath]: project }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [resolved, views, profilePath]);

  function updateSlot(id: string, next: Partial<CompareSlot>): void {
    setSlots((prev) => prev.map((slot) => (slot.id === id ? { ...slot, ...next } : slot)));
  }

  function addSlot(): void {
    setSlots((prev) => (prev.length >= 4 ? prev : [...prev, { ...prev[prev.length - 1], id: nextSlotId() }]));
  }

  function closeSlot(id: string): void {
    setSlots((prev) => (prev.length <= 1 ? prev : prev.filter((slot) => slot.id !== id)));
  }

  return (
    <section className="compare-mode" data-testid="compare-mode">
      <div className="compare-toolbar">
        <span className="compare-hint">Pin up to 4 iterations · vary run, case, or iteration to compare permutations side by side</span>
        <button type="button" className="compare-add" onClick={addSlot} disabled={slots.length >= 4} data-testid="compare-add">
          + Add panel
        </button>
      </div>
      <div className={`compare-grid tiles-${slots.length}`} data-testid="compare-grid">
        {resolved.map(({ slot, overview, iteration }) => (
          <CompareTile
            key={slot.id}
            slot={slot}
            runs={runs}
            overview={overview}
            project={iteration ? views[iteration.tracePath] : undefined}
            canClose={slots.length > 1}
            onChange={(next) => updateSlot(slot.id, next)}
            onClose={() => closeSlot(slot.id)}
          />
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------- App ----------------------------------- */

export function App() {
  const [paths, setPaths] = useState<PathsState>(emptyPaths);
  const [project, setProject] = useState<LoadedProject>();
  const [mode, setMode] = useState<Mode>('trace');
  const [error, setError] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selectedNode, setSelectedNode] = useState<TraceNode>();
  const [outputPath, setOutputPath] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [annotationStatus, setAnnotationStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [run, setRun] = useState<RunOverview>();
  const [active, setActive] = useState<{ ref: string; iteration: number }>();
  const [runs, setRuns] = useState<RunSummary[]>([]);

  useEffect(() => {
    window.verity.listRuns().then(setRuns).catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    setOutputPath(project ? reviewedPath(project.traceUri) : '');
  }, [project?.traceUri]);

  const byPointer = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const annotation of project?.annotations ?? []) {
      const list = map.get(annotation.target.jsonPointer) ?? [];
      list.push(annotation);
      map.set(annotation.target.jsonPointer, list);
    }
    return map;
  }, [project?.annotations]);

  const annotationApi = useMemo<AnnotationContextValue>(
    () => ({
      byPointer,
      openKey,
      status: annotationStatus,
      saving,
      keyOf: targetKey,
      open: (target) => {
        setAnnotationStatus('');
        setOpenKey(targetKey(target));
      },
      close: () => setOpenKey(null),
      save: async (target, body) => {
        if (!project) return;
        setSaving(true);
        setAnnotationStatus('Patching reviewed artifact…');
        try {
          const result = await window.verity.saveAnnotation({
            label: target.label,
            body,
            tags: ['inline'],
            artifactRole: target.role,
            targetPointer: target.pointer,
            outputPath: outputPath || undefined
          });
          setProject(result.project);
          setAnnotationStatus(`Saved ${result.project.annotations.length} annotation(s) to ${result.outputPath}`);
          setOpenKey(null);
        } catch (cause) {
          setAnnotationStatus(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setSaving(false);
        }
      }
    }),
    [byPointer, openKey, annotationStatus, saving, project, outputPath]
  );

  async function load(nextPaths = paths) {
    setError('');
    const loaded = await window.verity.loadProject({
      profilePath: nextPaths.profilePath,
      tracePath: nextPaths.tracePath,
      evalPath: nextPaths.evalPath || undefined
    });
    setProject(loaded);
    setSelectedNode(loaded.traceNodes[0]);
    setHits(await window.verity.search('Dracula'));
    try {
      const overview = await window.verity.getRunOverview({
        profilePath: nextPaths.profilePath,
        tracePath: nextPaths.tracePath
      });
      setRun(overview.cases.length ? overview : undefined);
      setActive(overview.active ?? overview.cases[0]?.iterations[0]);
    } catch {
      setRun(undefined);
      setActive(undefined);
    }
  }

  async function loadIteration(iteration: IterationSummary): Promise<void> {
    setError('');
    const nextPaths: PathsState = {
      profilePath: paths.profilePath,
      tracePath: iteration.tracePath,
      evalPath: iteration.evalPath ?? ''
    };
    setPaths(nextPaths);
    try {
      const loaded = await window.verity.loadProject({
        profilePath: nextPaths.profilePath,
        tracePath: nextPaths.tracePath,
        evalPath: nextPaths.evalPath || undefined
      });
      setProject(loaded);
      setSelectedNode(loaded.traceNodes[0]);
      setHits(await window.verity.search('Dracula'));
      setActive({ ref: iteration.ref, iteration: iteration.iteration });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function openSearchHit(hit: SearchHit): void {
    if (hit.artifactRole === 'trace') {
      const matchingNode = project?.traceNodes.find((node) => hit.pointer === node.rawPointer || hit.pointer.startsWith(`${node.rawPointer}/`));
      if (matchingNode) setSelectedNode(matchingNode);
      setMode('trace');
      scrollModeIntoView('trace');
      return;
    }

    const nextMode = hit.artifactRole === 'eval' ? 'eval' : 'gt';
    setMode(nextMode);
    scrollModeIntoView(nextMode);
  }

  useEffect(() => {
    window.verity
      .getDefaultPaths()
      .then(async (defaults) => {
        setPaths(defaults);
        await load(defaults);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const selectedSummary = useMemo(() => selectedNode?.label ?? selectedNode?.kind ?? 'no node selected', [selectedNode]);

  return (
    <AnnotationContext.Provider value={annotationApi}>
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">Verity<b>.</b></span>
          <span className="brand-sub">Trace review workbench</span>
        </div>
        <div className="summary" data-testid="project-summary">
          <div className="summary-item">
            <span className="k">Profile</span>
            <span className="v">{project?.profile.name ?? 'No profile loaded'}</span>
          </div>
          <div className="summary-item">
            <span className="k">Records</span>
            <span className="v">{project ? `${project.traceNodes.length} trace records` : 'Loading…'}</span>
          </div>
          <div className="summary-item">
            <span className="k">Eval</span>
            <span className="v">{project?.evalStatus ?? selectedSummary}</span>
          </div>
        </div>
      </header>

      <section className="sources">
        <label>
          Profile
          <input value={paths.profilePath} onInput={(event) => setPaths({ ...paths, profilePath: event.currentTarget.value })} data-testid="profile-path" />
        </label>
        <label>
          Trace artifact
          <input value={paths.tracePath} onInput={(event) => setPaths({ ...paths, tracePath: event.currentTarget.value })} data-testid="trace-path" />
        </label>
        <label>
          Eval artifact
          <input value={paths.evalPath} onInput={(event) => setPaths({ ...paths, evalPath: event.currentTarget.value })} data-testid="eval-path" />
        </label>
        <button type="button" onClick={() => void load()} data-testid="load-project">Load</button>
      </section>

      {error && <div className="banner error-banner">{error}</div>}
      {project?.validationErrors.length ? (
        <div className="banner warning-banner" data-testid="validation-errors">{project.validationErrors.join(' · ')}</div>
      ) : null}

      <nav className="mode-tabs">
        {(['trace', 'gt', 'eval', 'compare'] as Mode[]).map((item) => (
          <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)} data-testid={`mode-${item}`}>
            {MODE_LABELS[item]}
          </button>
        ))}
      </nav>

      <div className={`main-grid ${mode === 'compare' ? 'compare-active' : ''}`}>
        <div className="primary-stage">
          {run && active && mode !== 'compare' ? (
            <IterationNavigator
              run={run}
              activeRef={active.ref}
              activeIter={active.iteration}
              onSelectIteration={(iteration) => void loadIteration(iteration)}
            />
          ) : null}
          {project && mode === 'trace' && <TraceMode project={project} selectedNode={selectedNode} onSelectNode={setSelectedNode} />}
          {project && mode === 'gt' && <GtMode project={project} />}
          {project && mode === 'eval' && <EvalMode project={project} />}
          {mode === 'compare' &&
            (runs.length && run && active ? (
              <CompareMode
                runs={runs}
                profilePath={paths.profilePath}
                seed={{ id: 'seed', runFolder: run.runFolder, runPath: run.runPath, ref: active.ref, iteration: active.iteration }}
              />
            ) : (
              <div className="empty-state" data-testid="compare-mode">Load a run to compare iterations side by side.</div>
            ))}
        </div>
        {mode !== 'compare' ? (
          <aside className="side-rail">
            <SearchPanel hits={hits} onSearch={(query) => void window.verity.search(query).then(setHits)} onSelectHit={openSearchHit} />
            <ReviewSessionPanel project={project} outputPath={outputPath} onOutputPathChange={setOutputPath} status={annotationStatus} />
          </aside>
        ) : null}
      </div>
    </main>
    </AnnotationContext.Provider>
  );
}
