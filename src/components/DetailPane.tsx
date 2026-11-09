import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  Frame,
  HangSignature,
  ProcessedProfile,
} from "@/processing/types";
import type { TimeseriesIndex } from "@/data/timeseries";
import { computeTrend, trendSentence } from "@/data/trend";
import { buildBugReport, buildHangSummary } from "@/data/bugReport";
import { tagCandidates, tagScopes, type TagCandidate, type TagScope } from "@/data/tagScope";
import {
  MECHANISMS,
  areaLabel,
  frameRole,
  hangContext,
  type FrameTable,
} from "@/data/hangAreas";
import {
  classifyStack,
  dominantPlatform,
  type BugComponent,
} from "@/data/componentMap";
import { isKnownComponent, type ProductComponents } from "@/data/components";
import { useComponents, useSourceResolver } from "@/queries/hooks";
import {
  githubLine,
  jsFrameLocation,
  searchableName,
  searchfoxLine,
  searchfoxSearch,
  type SourceResolver,
} from "@/data/sourceLinks";
import { resolveFrames } from "@/processing/select";
import { platformBaseline, platformSkew } from "@/data/platformSkew";
import { platformLabel } from "@/data/platforms";
import { formatDate, formatShare } from "@/format";
import { isOwnCode } from "@/frames";
import { Highlight } from "./Highlight";
import { InfoTip } from "./InfoTip";
import { TimeseriesChart } from "./TimeseriesChart";
import { HangSummary, evidenceMarks } from "./HangSummary";
import { GroupRelationNote } from "./GroupRelationNote";
import { memberStacks } from "@/processing/signatureKey";
import { useViewState } from "@/state/useViewState";
import { investigationLink, isLegacyStackId } from "@/state/permalink";

interface DetailPaneProps {
  onBack: () => void;
  profile: ProcessedProfile;
  signature: HangSignature | null;
  /** The `selected` id asked for, which may name a hang not in this build. */
  requestedId: string | null;
  filter: string;
  timeseries: TimeseriesIndex | undefined;
  /** The near-duplicate group the list is narrowed to, if any. */
  activeGroup: string | null;
  /** Narrow the list to a near-duplicate group, or back to every hang (null). */
  onShowGroup: (groupKey: string | null) => void;
  /** Set the list's text filter (to list what a bug tag would match). */
  onFilter?: (text: string) => void;
}

export function DetailPane({
  onBack,
  profile,
  signature,
  requestedId,
  filter,
  timeseries,
  activeGroup,
  onShowGroup,
  onFilter,
}: DetailPaneProps) {
  const { state } = useViewState();
  // A newly selected hang starts at the top of its details, not wherever the
  // previous one had been scrolled to.
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    paneRef.current?.scrollTo(0, 0);
  }, [signature?.id]);

  // A summary's evidence link scrolls the stack to its frame and flashes it.
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    if (flash === null) {
      return;
    }
    paneRef.current
      ?.querySelector(`[data-depth="${flash}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(timer);
  }, [flash]);

  if (!signature) {
    return (
      <div className="detail-empty">
        {requestedId ? (
          <div>
            <MissingHang build={profile.date} legacy={isLegacyStackId(requestedId)} />
            <button className="btn secondary missing-back" onClick={onBack}>Back to hangs</button>
          </div>
        ) : (
          <div className="inspector-welcome">
            <div className="inspector-symbol" aria-hidden="true"><span /><span /><span /></div>
            <span className="eyebrow">Hang inspector</span>
            <h2>Select a hang</h2>
            <p>Select a hang to explore its stack, history, and context.</p>
            <div className="inspector-hint"><span aria-hidden="true">←</span> Choose a row to begin</div>
          </div>
        )}
      </div>
    );
  }
  const frames = resolveFrames(profile, signature.frameKeys);
  const permalink = investigationLink(state, profile.date, signature.id);

  // The bug comment states the trend with its dates and coverage, so whoever
  // reads it can judge the claim without opening the dashboard.
  const series = timeseries?.resolveSignature(signature);
  const trendNote = series
    ? trendSentence(computeTrend(series, "ms", { endDate: profile.date }))
    : undefined;

  return (
    <div className="detail-pane" ref={paneRef}>
      <SectionNav paneRef={paneRef}>
        <button className="inspector-back" onClick={onBack}>← Back to hangs</button>
      </SectionNav>
      <HangSummary key={signature.id} signature={signature} frames={frames} onJump={setFlash}
        action={<CopyLink href={permalink} build={profile.date} />} />
      {/* What the stack shows, then the stack: together they say what the hang
          is, and everything below is about how often and where it happens. */}
      <StackSection
        key={`stack:${signature.id}`}
        frames={frames}
        filter={filter}
        marks={evidenceMarks(signature.kind)}
        flash={flash}
        table={profile.frameTable}
      />

      <TimeseriesChart index={timeseries} signature={signature} endDate={profile.date} />

      <LeafGroupSection
        profile={profile}
        signature={signature}
        filter={filter}
        activeGroup={activeGroup}
        onShowGroup={onShowGroup}
      />

      <FileBugSection
        profile={profile}
        signature={signature}
        frames={frames}
        trendNote={trendNote}
        permalink={permalink}
        onFilter={onFilter}
      />

      <PlatformSection profile={profile} signature={signature} />

      <AffectedClientsSection
        profile={profile}
        signature={signature}
        timeseries={timeseries}
      />

      <AnnotationStatsSection key={`annotations:${signature.id}`} signature={signature} />

    </div>
  );
}

/** Why a linked hang isn't shown: the build doesn't have it. */
function MissingHang({ build, legacy }: { build: string; legacy: boolean }) {
  return (
    <>
      That hang isn&rsquo;t in build {formatDate(build)}.
      {legacy && (
        <p className="muted">
          The link is from an older HangTime, whose links only find a hang on the
          build they were copied from.
        </p>
      )}
    </>
  );
}

/** Copies a link to this hang that stays on this build. */
function CopyLink({ href, build }: { href: string; build: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      return; // clipboard refused; the link itself can still be copied
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <a
      className="link detail-link"
      href={href}
      onClick={(e) => {
        e.preventDefault();
        copy();
      }}
      title={
        `A link to this hang on build ${formatDate(build)}, with the list's filters. ` +
        "It stays on that build when newer ones arrive."
      }
    >
      {copied ? "Copied" : "Copy link"}
    </a>
  );
}

/**
 * A row of links to the sections this hang has, so a long pane (a 60-frame
 * stack pushes the history and filing several screens down) is one click from
 * any part. Sections mark themselves with `data-section`; reading them from
 * the page keeps this in step with whichever ones rendered.
 */
function SectionNav({
  paneRef,
  children,
}: {
  paneRef: React.RefObject<HTMLDivElement>;
  /** Pane-wide actions, set at the row's end (Copy link). */
  children?: React.ReactNode;
}) {
  const [sections, setSections] = useState<string[]>([]);
  useLayoutEffect(() => {
    const found = [
      ...(paneRef.current?.querySelectorAll<HTMLElement>("[data-section]") ?? []),
    ].map((el) => el.dataset.section ?? "");
    setSections((prev) => (prev.join("|") === found.join("|") ? prev : found));
  });
  // With only a couple of sections there's nothing to jump between.
  const shown = sections.length < 3 ? [] : sections;
  return (
    <nav className="section-nav" aria-label="Sections">
      {shown.map((name) => (
        <button
          key={name}
          onClick={() =>
            paneRef.current
              ?.querySelector(`[data-section="${name}"]`)
              ?.scrollIntoView({ block: "start", behavior: "smooth" })
          }
        >
          {name}
        </button>
      ))}
      {children && <span className="section-nav-end">{children}</span>}
    </nav>
  );
}

/** Stacks up to this long are always shown whole. */
const FOCUS_MIN_FRAMES = 16;
/** A focused stack shows at least this many leaf frames... */
const LEAF_ROWS_MIN = 2;
/** ...and runs on to an evidence frame up to this depth. */
const LEAF_ROWS_MAX = 6;

/**
 * The stack. A long one opens focused: the leaf frames, where the hang
 * actually is, then only the frames the summary points at or the filter
 * matches, with each run in between folded into one row that says how many
 * frames it holds and what kind. "Show all" brings back every frame.
 *
 * Remounted per hang (keyed by the caller), so a new selection starts focused.
 */
export function StackSection({
  frames,
  filter,
  marks,
  flash,
  table,
}: {
  frames: Frame[];
  filter: string;
  /** Depth -> the summary rows that point at that frame. */
  marks: Map<number, string[]>;
  flash: number | null;
  table: FrameTable;
}) {
  const resolver = useSourceResolver().data;
  const [showAll, setShowAll] = useState(false);
  const [copyStatus, setCopyStatus] = useState("Copy stack");
  const copyStack = async () => {
    try {
      await navigator.clipboard.writeText(frames.map((frame, depth) =>
        `${depth} ${frame.funcName}${frame.libName ? ` [${frame.libName}]` : ""}`,
      ).join("\n"));
      setCopyStatus("Stack copied");
    } catch {
      setCopyStatus("Copy failed — select stack text");
    }
  };
  // Frames brought back one run at a time, or by a summary link.
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set());
  // A summary link to a folded frame shows it at once (so the pane can scroll
  // to it in the same render) and keeps it shown once the flash has faded.
  useEffect(() => {
    if (flash !== null) {
      setRevealed((prev) => (prev.has(flash) ? prev : new Set(prev).add(flash)));
    }
  }, [flash]);

  const focusable = frames.length > FOCUS_MIN_FRAMES;
  const focused = useMemo(() => {
    if (!focusable) {
      return frames.map(() => true);
    }
    let leafEnd = LEAF_ROWS_MIN - 1;
    for (const depth of marks.keys()) {
      if (depth < LEAF_ROWS_MAX) {
        leafEnd = Math.max(leafEnd, depth);
      }
    }
    const matches = frameMatcher(filter);
    return unfoldShortRuns(
      frames.map((frame, i) => i <= leafEnd || marks.has(i) || matches(frame)),
    );
  }, [frames, focusable, marks, filter]);
  const visible = showAll
    ? focused.map(() => true)
    : unfoldShortRuns(focused.map((v, i) => v || revealed.has(i) || i === flash));
  const hidden = visible.filter((v) => !v).length;
  // Whether anything beyond the focused view is showing, to offer going back.
  const expanded = showAll || visible.some((v, i) => v && !focused[i]);

  // Visible frames as rows, each folded run between them as a single row.
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < frames.length; ) {
    if (visible[i]) {
      rows.push(
        <FrameRow
          key={i}
          depth={i}
          frame={frames[i]}
          filter={filter}
          marks={marks.get(i)}
          flash={flash === i}
          resolver={resolver}
        />,
      );
      i++;
      continue;
    }
    const start = i;
    while (i < frames.length && !visible[i]) {
      i++;
    }
    const run = frames.slice(start, i);
    rows.push(
      <button
        key={`run-${start}`}
        className="frame frame-run"
        onClick={() =>
          setRevealed((prev) => {
            const next = new Set(prev);
            for (let d = start; d < start + run.length; d++) {
              next.add(d);
            }
            return next;
          })
        }
        title={`Show frames ${start} to ${start + run.length - 1}`}
      >
        <span className="idx">…</span>
        <span className="name">
          {run.length} {run.length === 1 ? "frame" : "frames"}: {describeRun(run, table)}
        </span>
      </button>,
    );
  }

  return (
    <div className="detail-section" data-section="Stack">
      <div className="ts-header">
        <h3>
          Stack ({frames.length} frames)
          <InfoTip label="Stack">
            Frame 0 is where the thread was stuck; each frame below called the one
            above. Firefox&rsquo;s own code is in normal text, system libraries are
            dimmed. A long stack opens on the frames that matter: the leaf end, the
            frames the summary points at, and any the filter matches. Click a folded
            row, or <b>Show all</b>, for the rest.
            <span className="eg">
              <b>Searchfox</b> and <b>GitHub</b> open a JavaScript frame&rsquo;s file at
              its line. For a C++ frame, <b>Searchfox</b> searches for the function,
              which leads to its definition: the hang data doesn&rsquo;t carry C++ file
              and line numbers yet (
              <a
                href="https://bugzilla.mozilla.org/show_bug.cgi?id=2081894"
                target="_blank"
                rel="noreferrer"
              >
                bug 2081894
              </a>
              ). Links show the current source, so a line can
              have moved if the file changed since this build.
            </span>
          </InfoTip>
        </h3>
        <span className="stack-toggles">
          <button className="link" onClick={copyStack} aria-live="polite" title="Copy every frame with full function arguments, including folded frames">{copyStatus}</button>
          {hidden > 0 && (
            <button className="link" onClick={() => setShowAll(true)}>
              Show all {frames.length} frames
            </button>
          )}
          {expanded && (
            <button
              className="link"
              onClick={() => {
                setShowAll(false);
                setRevealed(new Set());
              }}
            >
              Show focused
            </button>
          )}
        </span>
      </div>
      <div className="stack-trace">
        {frames.length === 0 && <div className="frame">(empty stack)</div>}
        {rows}
      </div>
    </div>
  );
}

function FrameRow({
  depth,
  frame,
  filter,
  marks,
  flash,
  resolver,
}: {
  depth: number;
  frame: Frame;
  filter: string;
  marks: string[] | undefined;
  flash: boolean;
  resolver?: SourceResolver;
}) {
  return (
    <div
      data-depth={depth}
      className={[
        "frame",
        isOwnCode(frame) ? "" : "system",
        marks ? "marked" : "",
        flash ? "flash" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="idx">{depth}</span>
      <span className="name">
        <Highlight text={frame.funcName} needle={filter} />
        {marks?.map((mark) => (
          <span key={mark} className="frame-mark">
            {mark}
          </span>
        ))}
      </span>
      {frame.libName && (
        <span className="lib">
          <Highlight text={frame.libName} needle={filter} />
        </span>
      )}
      <FrameLinks frame={frame} resolver={resolver} />
    </div>
  );
}

/**
 * Whether a frame matches the list's text filter, with the list's rule: all
 * lower-case matches any case (see `stackMatcher`).
 */
function frameMatcher(filter: string): (frame: Frame) => boolean {
  if (!filter) {
    return () => false;
  }
  const caseInsensitive = filter.toLowerCase() === filter;
  const has = (value: string) =>
    caseInsensitive ? value.toLowerCase().includes(filter) : value.includes(filter);
  return (frame) => has(frame.funcName) || has(frame.libName);
}

/** What a folded run of frames mostly is, so skipping it is an informed choice. */
function describeRun(run: Frame[], table: FrameTable): string {
  const counts: Record<string, number> = {};
  for (const frame of run) {
    const role = frameRole(table, frame.funcIndex);
    // Unsymbolicated frames read as glue: neither says what the code does.
    const name = RUN_ROLES[role === "unknown" ? "glue" : role];
    counts[name] = (counts[name] ?? 0) + 1;
  }
  const [first, second] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return first[1] >= run.length * 0.7 || !second
    ? first[0]
    : `mostly ${first[0]}, some ${second[0]}`;
}

/** Runs shorter than this are shown: folding them saves no space. */
const MIN_RUN = 3;

function unfoldShortRuns(visible: boolean[]): boolean[] {
  const out = [...visible];
  for (let i = 0; i < out.length; ) {
    if (out[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < out.length && !out[i]) {
      i++;
    }
    if (i - start < MIN_RUN) {
      out.fill(true, start, i);
    }
  }
  return out;
}

const RUN_ROLES = {
  glue: "event loop and glue",
  system: "system libraries",
  firefox: "Firefox code",
};

/** Source links for one stack frame, or nothing for a system library frame. */
function FrameLinks({ frame, resolver }: { frame: Frame; resolver?: SourceResolver }) {
  const link = (href: string, text: string, title: string) => (
    <a href={href} target="_blank" rel="noreferrer" title={title}>
      {text}
    </a>
  );

  const js = jsFrameLocation(frame.funcName);
  if (js) {
    const src = resolver?.resolve(js.path);
    if (src) {
      const where = `${src}:${js.line}`;
      return (
        <span className="frame-links">
          {link(searchfoxLine(src, js.line), "Searchfox", `Open ${where} in Searchfox`)}
          {link(githubLine(src, js.line), "GitHub", `Open ${where} on GitHub`)}
        </span>
      );
    }
    // Not resolved (or the map is still loading): search for the file instead.
    const file = js.path.slice(js.path.lastIndexOf("/") + 1);
    return (
      <span className="frame-links">
        {link(searchfoxSearch(file), "Searchfox", `Search Searchfox for ${file}`)}
      </span>
    );
  }

  // Firefox's own native frames, and its labelled frames (no library), which
  // name Firefox code too; system library frames have no Firefox source.
  if (!isOwnCode(frame)) {
    return null;
  }
  const name = searchableName(frame.funcName);
  return name ? (
    <span className="frame-links">
      {link(searchfoxSearch(name), "Searchfox", `Search Searchfox for ${name}`)}
    </span>
  ) : null;
}

function FileBugSection({
  profile,
  signature,
  frames,
  trendNote,
  permalink,
  onFilter,
}: {
  profile: ProcessedProfile;
  signature: HangSignature;
  frames: Frame[];
  trendNote?: string;
  /** Link to this hang pinned to its build, for the bug's Dashboard line. */
  permalink: string;
  onFilter?: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [override, setOverride] = useState<BugComponent | null>(null);
  const [tagChoice, setTagChoice] = useState<string | null>(null);
  const componentList = useComponents();
  const tracked = !!signature.knownBug;

  const platform = dominantPlatform(signature.platformStats);
  const suggestion = useMemo(
    () => classifyStack(frames, platform),
    [frames, platform],
  );
  // A tracked hang already has its tag; only a new bug needs one chosen.
  const { candidates, preferred } = useMemo(
    () => (tracked ? { candidates: [], preferred: 0 } : tagCandidates(profile, signature)),
    [profile, signature, tracked],
  );
  const scopes = useMemo(
    () => tagScopes(profile, candidates.map((c) => c.tag)),
    [profile, candidates],
  );

  // A new selection means a new suggestion; drop any override from the last one.
  useEffect(() => {
    setOverride(null);
    setTagChoice(null);
  }, [signature.id]);

  const suggested =
    suggestion && isKnownComponent(componentList.data, suggestion)
      ? { product: suggestion.product, component: suggestion.component }
      : null;
  const target = override ?? suggested;
  const candidate = candidates.find((c) => c.tag === tagChoice) ?? candidates[preferred];
  const tag = candidate?.tag ?? "";

  const facts = {
    frames,
    kind: signature.kind,
    count: signature.count,
    durationMs: signature.duration,
    date: formatDate(profile.date),
    trendNote,
    permalink,
    contexts: hangContext(signature.annotationStats, signature.count),
    platformNote: platformNote(signature.platformStats),
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (signature.knownBug) {
    return (
      <div className="detail-section" data-section="File a bug">
        <h3>File a bug</h3>
        <p className="muted">
          Already tracked by Bug {signature.knownBug.id}.{" "}
          <button className="link" onClick={() => copy(buildHangSummary(facts))}>
            {copied ? "Copied" : "Copy hang summary"}
          </button>{" "}
          to add current data to it.
        </p>
      </div>
    );
  }

  const report = buildBugReport({ ...facts, tag, target: target ?? undefined });

  return (
    <div className="detail-section" data-section="File a bug">
      <h3>
        File a bug
        <InfoTip label="File a bug">
          Files straight into the chosen component with the summary, what the stack
          shows, the stack, prevalence and whiteboard tag already filled in.
          <span className="eg">
            The component is guessed by reading the stack from the leaf outwards
            for the innermost frame that names an owner, skipping plumbing like
            binding glue and the IPC transport. On the hangs already tracked by
            a bug it picks the component those bugs were really filed in about
            four times in five, so check it before filing.
          </span>
          <span className="eg">
            The whiteboard tag folds every hang with a matching function name into
            the bug, so it is taken from a frame specific to this hang (the code
            that made the blocking call) rather than the primitive the thread was
            stuck in. The line below it says what the tag would match on this build.
          </span>
        </InfoTip>
      </h3>
      <p className="muted">
        {suggestion
          ? "HangTime has suggested the following component for this hang signature, you may also change this if you feel this is wrong."
          : "HangTime couldn’t tell which component owns this hang: the stack is all shared plumbing. Please pick one."}
      </p>
      <ComponentPicker
        value={target}
        list={componentList.data}
        onChange={setOverride}
      />
      {suggestion && (
        <p className="bug-why">
          <span>
            Suggested from frame {suggestion.frameIndex},{" "}
            <code>{shortName(suggestion.frameName)}</code>, which matched{" "}
            <code>{suggestion.matched}</code>.
          </span>
          {suggestion.caveat && (
            <span
              className="chip amber"
              title={
                suggestion.caveat === "broad-rule"
                  ? "The matching rule names a namespace or layer shared by many components"
                  : "The deciding frame is far from where the thread was stuck"
              }
            >
              {suggestion.caveat === "broad-rule" ? "broad match" : "deep in the stack"}: check it
            </span>
          )}
        </p>
      )}
      <p className="muted">
        Files with whiteboard tag <code>{report.whiteboard}</code>, so the
        dashboard auto-merges matching hangs from the next run.
      </p>
      {candidate && (
        <TagScopeNote
          candidate={candidate}
          scope={scopes.get(tag)}
          signature={signature}
          onFilter={onFilter}
        />
      )}
      {candidates.length > 1 && (
        <TagPicker
          candidates={candidates}
          scopes={scopes}
          total={profile.totalDuration}
          value={tag}
          onChange={setTagChoice}
        />
      )}
      <div className="report-actions">
        <a
          className={`btn${target ? "" : " disabled"}`}
          href={target ? report.url : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!target}
        >
          {target ? `File in ${target.component}` : "Pick a component first"}
        </a>
        <button className="btn secondary" onClick={() => copy(report.comment)}>
          {copied ? "Copied" : "Copy comment"}
        </button>
      </div>
    </div>
  );
}

/** A tag matching more than this many signatures folds in more than one hang. */
const BROAD_SIGNATURES = 5;
/** ... or more than this multiple of the hang's own time. */
const BROAD_TIME = 3;
/** Matched time outside the hang's own area past which it's likely several problems. */
const MIXED_SHARE = 0.3;
/** ... and past which a wide tag is worth a second look. */
const MIXED_NOTE = 0.1;

/**
 * What the chosen tag would fold into the bug on this build, and a warning when
 * that is more than this hang: a shared primitive, or signatures spread across
 * several areas.
 */
function TagScopeNote({
  candidate,
  scope,
  signature,
  onFilter,
}: {
  candidate: TagCandidate;
  scope: TagScope | undefined;
  signature: HangSignature;
  onFilter?: (text: string) => void;
}) {
  if (!scope) {
    return null;
  }
  const { area } = signature.kind;
  const inArea = scope.msByArea.get(area) ?? 0;
  const outside = scope.ms > 0 ? 1 - inArea / scope.ms : 0;
  const wide = scope.signatures > BROAD_SIGNATURES || scope.ms > BROAD_TIME * signature.duration;
  const mixed = scope.signatures > BROAD_SIGNATURES && outside >= MIXED_SHARE;
  const pct = (share: number) =>
    share.toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 });
  const { generic } = candidate;

  let warning: React.ReactNode = null;
  if (generic) {
    const what =
      generic.kind === "mechanism"
        ? `a ${MECHANISMS[generic.mechanism].phrase} frame`
        : generic.kind === "system"
          ? "system library code"
          : "shared glue code";
    warning = (
      <>
        <code>{candidate.tag}</code> is {what} that many unrelated hangs pass through,
        so this tag would fold them into one bug. Pick a frame specific to this hang.
      </>
    );
  } else if (mixed) {
    warning = (
      <>
        Its {scope.signatures.toLocaleString()} signatures span several areas: only{" "}
        {pct(1 - outside)} of their hang time is in {areaLabel(area)}, so they may be
        different problems. A frame closer to this hang&rsquo;s own code would be
        narrower.
      </>
    );
  }

  return (
    <>
      <p className={`tag-scope${warning ? " warn" : ""}`}>
        This tag would match <b>{scope.signatures.toLocaleString()}</b> signature
        {scope.signatures === 1 ? "" : "s"} and <b>{pct(scope.share)}</b> of observed hang
        time on this build
        {scope.trackedElsewhere > 0 && (
          <>
            , {scope.trackedElsewhere.toLocaleString()} of them already tracked by other
            bugs
          </>
        )}
        .
        {onFilter && scope.signatures > 1 && (
          <>
            {" "}
            <button className="link" onClick={() => onFilter(candidate.tag)}>
              List them
            </button>
          </>
        )}
      </p>
      {warning && <p className="tag-warning">{warning}</p>}
      {!warning && wide && outside >= MIXED_NOTE && (
        <p className="muted tag-note">
          It folds {scope.signatures.toLocaleString()} signatures into one bug, with{" "}
          {pct(1 - outside)} of their time in {areaLabel(area)}. Check they are the same
          problem before filing.
        </p>
      )}
    </>
  );
}

/** The frame the whiteboard tag is taken from, with what each would match. */
function TagPicker({
  candidates,
  scopes,
  total,
  value,
  onChange,
}: {
  candidates: TagCandidate[];
  scopes: Map<string, TagScope>;
  total: number;
  value: string;
  onChange: (tag: string) => void;
}) {
  const option = (c: TagCandidate) => {
    const scope = scopes.get(c.tag);
    const n = scope?.signatures ?? 0;
    const matches = `${n.toLocaleString()} signature${n === 1 ? "" : "s"}`;
    return (
      <option key={c.tag} value={c.tag}>
        {`frame ${c.depth}: ${c.tag}  (${matches}, ${formatShare(scope?.ms ?? 0, total)})`}
      </option>
    );
  };
  const specific = candidates.filter((c) => !c.generic);
  const shared = candidates.filter((c) => c.generic);
  return (
    <label className="tag-picker">
      <span>Tag frame</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {specific.length > 0 && (
          <optgroup label="Specific to this hang">{specific.map(option)}</optgroup>
        )}
        {shared.length > 0 && (
          <optgroup label="Shared low-level frames (broad)">{shared.map(option)}</optgroup>
        )}
      </select>
    </label>
  );
}

/** Drop the argument list so a deciding frame reads as a name. */
function shortName(funcName: string): string {
  const paren = funcName.indexOf("(");
  return paren <= 0 ? funcName : funcName.slice(0, paren);
}

/** "Windows 96%, macOS 3%" for the bug comment. */
function platformNote(stats: Record<string, number>): string | undefined {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (!total) {
    return undefined;
  }
  return Object.entries(stats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([os, n]) => `${os} ${Math.round((n / total) * 100)}%`)
    .join(", ");
}

/**
 * Product/component picker. Offers Bugzilla's live list when it loaded, and
 * otherwise just the suggestion, so a Bugzilla outage can't block filing.
 */
function ComponentPicker({
  value,
  list,
  onChange,
}: {
  value: BugComponent | null;
  list: ProductComponents[] | undefined;
  onChange: (target: BugComponent) => void;
}) {
  const key = value ? `${value.product}|${value.component}` : "";
  return (
    <div className="component-row">
      {value && <span className="component-product">{value.product} ::</span>}
      <select
        className="component-picker"
        value={key}
        onChange={(e) => {
          const [product, component] = e.target.value.split("|");
          onChange({ product, component });
        }}
      >
      {!value && <option value="">Choose a component…</option>}
      {list?.map((entry) => (
        <optgroup key={entry.product} label={entry.product}>
          {entry.components.map((component) => (
            <option
              key={component}
              value={`${entry.product}|${component}`}
            >
              {component}
            </option>
          ))}
        </optgroup>
      ))}
      {!list && value && (
        <option value={key}>
          {value.product} :: {value.component}
        </option>
      )}
      </select>
    </div>
  );
}

/** One collapsed near-duplicate variant: group members with an identical
 * meaningful stack, folded into a single deduplicated row. */
function LeafGroupSection({ profile, signature, filter, activeGroup, onShowGroup }: {
  profile: ProcessedProfile;
  signature: HangSignature;
  filter: string;
  activeGroup: string | null;
  onShowGroup: (key: string | null) => void;
}) {
  const key = profile.leafGroupByKey?.[signature.frameKeys.join(",")]?.groupKey;
  const group = key ? profile.groupsByKey?.[key] : undefined;
  if (!group) return null;
  return <div className="detail-section" data-section="Near-duplicates">
    <h3>Near-duplicate group<InfoTip label="Near-duplicate group">
      Groups share a meaningful stack frame; this does not establish a shared cause.
      Open the group in the left list to inspect individual stacks and compare Original A
      with up to three candidates. Each stack keeps its own color and checkbox.
    </InfoTip></h3>
    <div className="group-head">
      <span className="group-toggle-name"><Highlight text={group.displayName} needle={filter} /></span>
      <span className="group-badge">{group.memberCount.toLocaleString()} stacks</span>
      <GroupRelationNote profile={profile} group={group} />
    </div>
    <div className="group-actions"><button className="btn secondary" onClick={() => onShowGroup(activeGroup === key ? null : key ?? null)}>
      {activeGroup === key ? "Show all hangs in the list" : `Show ${group.memberCount.toLocaleString()} stacks in the list ←`}
    </button></div>
  </div>;
}


function PlatformSection({
  profile,
  signature,
}: {
  profile: ProcessedProfile;
  signature: HangSignature;
}) {
  const skew = useMemo(
    () => platformSkew(signature.platformStats, platformBaseline(profile)),
    [signature.platformStats, profile],
  );
  if (skew.reports === 0) {
    return null;
  }
  const pct = (n: number) =>
    n.toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 });
  const times = (ratio: number | null) =>
    ratio == null ? "–" : `${ratio < 0.05 ? "0" : ratio.toFixed(1)}×`;
  const count = (n: number) => `${n.toLocaleString()} report${n === 1 ? "" : "s"}`;

  const { verdict } = skew;
  let summary: React.ReactNode;
  if (verdict.kind === "too-few") {
    summary = <>Only {count(verdict.reports)}, too few to compare platforms.</>;
  } else if (verdict.kind === "single") {
    const name = platformLabel(verdict.os);
    summary =
      verdict.share === 1 ? (
        <>
          <b>{name} only</b>: all {count(verdict.reports)} came from {name}.
        </>
      ) : (
        <>
          <b>Almost all {name}</b>: {pct(verdict.share)} of {count(verdict.reports)}.
        </>
      );
  } else if (verdict.kind === "skewed") {
    const [first, ...rest] = verdict.rows;
    summary =
      rest.length === 0 ? (
        <>
          <b>More common on {first.label}</b> than across all hangs:{" "}
          {pct(first.share)} of this hang&rsquo;s reports, against {pct(first.baseline)}{" "}
          of all hangs ({times(first.ratio)}).
        </>
      ) : (
        <>
          <b>
            More common on{" "}
            {verdict.rows.map((row, i) => (
              <span key={row.os}>
                {i > 0 && (i === verdict.rows.length - 1 ? " and " : ", ")}
                {row.label} ({times(row.ratio)})
              </span>
            ))}
          </b>{" "}
          than across all hangs.
        </>
      );
  } else {
    summary = <>In line with all hangs: no platform carries noticeably more of it.</>;
  }

  return (
    <div className="detail-section" data-section="Platform">
      <h3>
        Platform
        <InfoTip label="Platform">
          Most hang reports come from Windows, so nearly every hang is mostly
          Windows; that alone says little. This compares each platform&rsquo;s share
          of <em>this</em> hang with its share of <em>all</em> hangs on the build.{" "}
          <code>1×</code> is in line with all hangs; <code>2×</code> means the
          platform carries twice the share of this hang that it does of hangs
          overall.
          <span className="eg">
            A platform is only called out at 1.5× or more, with at least 20 reports
            from it, and when the gap is too large to be chance. The comparison is
            with all hangs, not all users: per-platform user counts aren&rsquo;t in
            the data yet (
            <a
              href="https://bugzilla.mozilla.org/show_bug.cgi?id=2081885"
              target="_blank"
              rel="noreferrer"
            >
              bug 2081885
            </a>
            ).
          </span>
        </InfoTip>
      </h3>
      <p className="platform-summary">{summary}</p>
      <div className="platform-rows">
        {skew.rows.map((row) => (
          <div key={row.os} className={`platform-row${row.notable ? " notable" : ""}`}>
            <span className="platform-name">{row.label}</span>
            <span
              className="platform-track"
              title={`${pct(row.share)} of this hang (${count(row.count)}); ${pct(row.baseline)} of all hangs`}
            >
              <span className="platform-fill" style={{ width: `${row.share * 100}%` }} />
              <span className="platform-mark" style={{ left: `${row.baseline * 100}%` }} />
            </span>
            <span className="platform-share">{pct(row.share)}</span>
            <span className="platform-base">all hangs {pct(row.baseline)}</span>
            <span className="platform-ratio">
              {row.count === 0
                ? "none"
                : verdict.kind === "too-few"
                  ? "–" // a ratio from a handful of reports would only mislead
                  : times(row.ratio)}
            </span>
          </div>
        ))}
      </div>
      <p className="platform-key">
        <span className="platform-key-fill" /> share of this hang&rsquo;s{" "}
        {count(skew.reports)}
        <span className="platform-key-mark" /> share of all hangs on this build
      </p>
    </div>
  );
}

type AffectedWindowKey = "build" | "d7" | "d28" | "d365";

const AFFECTED_OPTIONS: { key: AffectedWindowKey; label: string }[] = [
  { key: "build", label: "This build" },
  { key: "d7", label: "7-Day" },
  { key: "d28", label: "28-Day" },
  { key: "d365", label: "365-Day" },
];

function AffectedClientsSection({
  profile,
  signature,
  timeseries,
}: {
  profile: ProcessedProfile;
  signature: HangSignature;
  timeseries: TimeseriesIndex | undefined;
}) {
  const [picked, setPicked] = useState<AffectedWindowKey>("build");
  const resolved = timeseries?.resolveAffectedSignature(signature) ?? null;

  // Only measured counts are shown: the build's come from a --client-metrics
  // run, the windows from a timeseries rolled up from such runs. Anything
  // missing is said to be missing, never estimated.
  const buildUsers = signature.affectedClients;
  const buildTotal = profile.affectedClientsTotal;
  const hasBuild = buildUsers != null && buildTotal != null;
  const available = (key: AffectedWindowKey) => (key === "build" ? hasBuild : !!resolved);
  const options = AFFECTED_OPTIONS.filter((o) => available(o.key));
  // A stale choice (a window this hang has no cross-day data for, say) falls
  // back to the first one that has data.
  const active = available(picked) ? picked : options[0]?.key;

  if (!active) {
    return (
      <div className="detail-section">
        <h3>Clients affected</h3>
        <p className="muted">Affected-client data unavailable for this build.</p>
      </div>
    );
  }

  return (
    <div className="detail-section" data-section="Clients">
      <div className="ts-header">
        <h3>
          Clients affected
          <InfoTip label="Clients affected">
            Distinct clients that hit this hang, estimated with HyperLogLog, as a
            share of the clients that sent any hang report for the same build or
            window. That is the population HangTime observes, not all Nightly
            users: clients that never reported a hang aren&rsquo;t in it, and
            sampling isn&rsquo;t accounted for, so this isn&rsquo;t a rate of
            affected users.
            <span className="eg">
              <b>This build</b> counts one build&rsquo;s reports. The{" "}
              <b>7 / 28 / 365-Day</b> windows merge per-day sketches, so a client
              that hangs on many days counts once. A row covering several stacks
              adds up each stack&rsquo;s count, and one client can hit several of
              them, so that sum is shown as <em>up to</em>: an upper bound.
            </span>
          </InfoTip>
        </h3>
        {options.length > 1 && (
          <select
            className="affected-window"
            value={active}
            onChange={(e) => setPicked(e.target.value as AffectedWindowKey)}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {active === "build" ? (
        <AffectedShare
          users={buildUsers!}
          total={buildTotal!}
          upperBound={memberStacks(signature).length > 1}
          scope="for this build"
          note="HyperLogLog estimate"
        />
      ) : (
        <WindowAffected resolved={resolved} windowKey={active} />
      )}
    </div>
  );
}

/**
 * One affected-client share, worded for what the denominator really is: the
 * clients that sent hang reports, not every user.
 */
function AffectedShare({
  users,
  total,
  upperBound,
  scope,
  note,
}: {
  users: number;
  total: number;
  /** Summed across stacks, so a client can be counted more than once. */
  upperBound: boolean;
  /** Which reports the denominator covers, e.g. "for this build". */
  scope: string;
  note: string;
}) {
  const pct =
    total > 0
      ? Math.min(users / total, 1).toLocaleString(undefined, {
          style: "percent",
          minimumFractionDigits: 2,
        })
      : "n/a";
  return (
    <ul className="annotation-list">
      <li>
        <code>Clients affected</code>{" "}
        <span className="pct">
          {upperBound && "up to "}
          {pct} of hang-reporting clients ({users.toLocaleString()} of{" "}
          {total.toLocaleString()} that sent hang reports {scope})
        </span>
      </li>
      <li>
        <span className="pct">
          {note}
          {upperBound ? "; summed across this row's stacks, so an upper bound" : ""}.
        </span>
      </li>
    </ul>
  );
}

/** Distinct clients affected over one trailing window (HLL-merged). */
function WindowAffected({
  resolved,
  windowKey,
}: {
  resolved: ReturnType<TimeseriesIndex["resolveAffectedSignature"]>;
  windowKey: "d7" | "d28" | "d365";
}) {
  const win = resolved?.windows.find((w) => w.key === windowKey);
  if (!win) {
    return <p className="muted">No cross-day client data for this hang.</p>;
  }
  const days = win.label.replace("-Day", "");
  return (
    <AffectedShare
      users={win.users}
      total={win.totalUsers}
      upperBound={!!resolved?.approximate}
      scope={`over the last ${days} days`}
      note={`HyperLogLog estimate, merged across the trailing ${days} days`}
    />
  );
}

/**
 * The hang's annotations: one line of the context they add up to, then every
 * key and value, with the share of reports carrying it, on demand. Remounted
 * per hang, so a new selection starts folded.
 */
function AnnotationStatsSection({ signature }: { signature: HangSignature }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(signature.annotationStats).sort(
    (a, b) => b[1].totalCount - a[1].totalCount,
  );
  if (entries.length === 0) {
    return null;
  }
  const pct = (n: number) =>
    (n / signature.count).toLocaleString(undefined, {
      style: "percent",
      minimumFractionDigits: 1,
    });
  const share = (n: number) =>
    n.toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 });
  const contexts = hangContext(signature.annotationStats, signature.count);

  return (
    <div className="detail-section" data-section="Annotations">
      <h3>
        Hang annotations
        <InfoTip label="Hang annotations">
          Context flags Firefox recorded with the hang (e.g.{" "}
          <code>UserInteracting</code> = the user was actively interacting). The
          percentage is the share of this signature&rsquo;s reports carrying that flag.
          <span className="eg">
            A report without a flag is unknown rather than &ldquo;no&rdquo;: Firefox
            only records a flag when it is set, and older builds record fewer of
            them. So <code>UserInteracting 60%</code> means at least 60% of reports
            came while the user was interacting.
          </span>
        </InfoTip>
      </h3>
      <p className="annotation-summary">
        {contexts.length > 0 ? (
          contexts.map((c) => (
            <span key={c.key} title={`${share(c.share)} of reports carry ${c.key}`}>
              {c.label} {share(c.share)}
            </span>
          ))
        ) : (
          <span className="summary-none">No context flags set</span>
        )}
      </p>
      <button className="link annotation-toggle" onClick={() => setOpen((o) => !o)}>
        {open
          ? "Hide the annotations"
          : `Show all ${entries.length} annotation${entries.length === 1 ? "" : "s"}`}
      </button>
      {open && (
        <ul className="annotation-list">
          {entries.map(([key, stat]) => {
            const values = Object.entries(stat.values);
            let detail: React.ReactNode;
            if (values.length === 1 && values[0][0] === "true") {
              detail = `${pct(values[0][1])} (${values[0][1].toLocaleString()} hangs)`;
            } else if (values.length === 1) {
              detail = (
                <>
                  {pct(values[0][1])} ({values[0][1].toLocaleString()} hangs:{" "}
                  <code>{values[0][0]}</code>)
                </>
              );
            } else {
              detail = (
                <>
                  {pct(stat.totalCount)} ({stat.totalCount.toLocaleString()} hangs:{" "}
                  {values
                    .sort((a, b) => b[1] - a[1])
                    .map(([v, c], idx) => (
                      <span key={v}>
                        {idx > 0 && ", "}
                        {c.toLocaleString()} <code>{v}</code>
                      </span>
                    ))}
                  )
                </>
              );
            }
            return (
              <li key={key}>
                <code>{key}</code> <span className="pct">{detail}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
