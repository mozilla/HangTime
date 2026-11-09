/**
 * The top of a hang's details: what the stack shows, in a few lines, before
 * the stack itself. An engineer who has never seen the signature should be
 * able to tell from here which area it is in, how the thread was stuck, when
 * it happens, and which frames say so; each piece of evidence jumps to its
 * frame in the stack below.
 */

import { useId, useState, type ReactNode } from "react";
import type { Frame, HangSignature } from "@/processing/types";
import {
  MECHANISMS,
  activityText,
  areaLabel,
  hangContext,
  hangTitle,
  mechanismLabel,
  type HangKind,
} from "@/data/hangAreas";
import { platformLabel } from "@/data/platforms";
import { InfoTip } from "./InfoTip";
import { leafFrameDepth, shortSymbol } from "@/frames";

interface HangSummaryProps {
  signature: HangSignature;
  frames: Frame[];
  /** Scroll the stack to a frame and flash it. */
  onJump: (depth: number) => void;
  contextAvailable?: boolean;
  action?: ReactNode;
}

export function HangSummary({ signature, frames, onJump, contextAvailable = true, action }: HangSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const evidenceId = useId();
  const { kind } = signature;
  const depth = leafFrameDepth(frames);
  const representative = frames[depth];
  const activity = activityText(kind);
  const contexts = hangContext(signature.annotationStats, signature.count);
  const platform = topPlatform(signature.platformStats);
  const pct = (share: number) =>
    share.toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 });

  const ref = (depth: number) =>
    depth >= 0 && frames[depth] ? (
      <button
        className="frame-ref"
        onClick={() => onJump(depth)}
        title={`Show frame ${depth} in the stack`}
      >
        <span className="frame-ref-idx">frame {depth}</span>
        <code>{shortSymbol(frames[depth].funcName)}</code>
        {frames[depth].libName && <span className="frame-ref-lib">{frames[depth].libName}</span>}
      </button>
    ) : null;

  return (
    <div className="detail-section hang-summary" data-section="Summary">
      <div className="summary-heading">
      <h3>
        Summary
        <InfoTip label="Summary">
          Read from the function names on the stack: the <b>mechanism</b> is how the
          thread was stuck where it was sampled, the <b>area</b> is the innermost
          frame that names a part of the browser, and <b>during</b> is the next area
          further out. <b>When</b> comes from the flags Firefox recorded with the
          reports.
          <span className="eg">
            It says where the thread was, not why: a file operation on the stack
            doesn&rsquo;t by itself mean the disk was slow. A flag missing from a
            report means unknown, not &ldquo;no&rdquo;, so the shares are a floor.
          </span>
        </InfoTip>
      </h3>
      {action}
      </div>
      <p className={`summary-title${signature.knownBug ? " summary-bug-title" : ""}`}>
        {signature.knownBug ? <a href={`https://bugzilla.mozilla.org/show_bug.cgi?id=${signature.knownBug.id}`} target="_blank" rel="noreferrer">
          Bug {signature.knownBug.id}: {signature.knownBug.summary}
        </a> : representative ? representative.funcName : "(empty stack)"}
      </p>
      {representative && <p className="summary-frame">
        <button className="link" onClick={() => onJump(depth)} title="Show the recorded leaf frame in the stack">
          Leaf frame {depth}{representative.libName && <> · {representative.libName}</>} ↗
          {signature.knownBug && <> · <code>{representative.funcName}</code></>}
        </button>
      </p>}
      <div className="summary-description">
        <button className="summary-disclosure" type="button"
          aria-expanded={expanded} aria-controls={evidenceId}
          onClick={() => setExpanded(!expanded)}
          title={expanded ? "Hide supporting frames" : "Show supporting frames"}>
          <svg className="summary-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="m4 2 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{hangTitle(kind)}{activity && <span className="summary-activity"> {activity}</span>}</span>
        </button>
        <InfoTip label="Stack description">
          This description is inferred by rules that match function and library
          names on the representative stack.
          <p><b>Mechanism</b> describes the operation visible on the stack, such
            as a lock wait or serialization. <b>Area</b> comes from the innermost
            substantive subsystem match; generic layers are a fallback.
            <b> During</b> names the next different subsystem further out.</p>
          <p>Expand the description to see the frames behind each label. Click a
            frame to inspect it. These labels describe the observed call path,
            not a confirmed root cause: passing through input code does not
            establish that an input method caused the hang.</p>
          <span className="eg">Platform and context percentages below are
            separate observations from reports, not part of these classification rules.</span>
        </InfoTip>
      </div>
      <div id={evidenceId} hidden={!expanded}>
      <dl className="summary-evidence">
        <dt>Mechanism</dt>
        <dd>
          <span title={MECHANISMS[kind.mechanism].blurb}>{mechanismLabel(kind)}</span>
          {ref(kind.mechanismFrame)}
        </dd>
        <dt>Area</dt>
        <dd>
          {areaLabel(kind.area)}
          {kind.area ? ref(kind.areaFrame) : (
            <span className="summary-none">no frame names a part of the browser</span>
          )}
        </dd>
        {kind.activity && (
          <>
            <dt>During</dt>
            <dd>
              {areaLabel(kind.activity)}
              {ref(kind.activityFrame)}
            </dd>
          </>
        )}
        {showCaller(kind) && (
          <>
            <dt>Caller</dt>
            <dd>{ref(kind.callerFrame)}</dd>
          </>
        )}
      </dl>
      </div>
      {contextAvailable ? <p className="summary-when">
        {platform && (
          <span title="Share of this hang's reports from its most common platform">
            {platformLabel(platform.os)} {pct(platform.share)}
          </span>
        )}
        {contexts.length > 0 ? (
          contexts.slice(0, 4).map((c) => (
            <span key={c.key} title={`${pct(c.share)} of reports carry ${c.key}`}>
              {c.label} {pct(c.share)}
            </span>
          ))
        ) : (
          <span className="summary-none">No context flags recorded</span>
        )}
      </p> : <p className="summary-when">Per-stack platform and context breakdowns unavailable.</p>}

    </div>
  );
}

/** The caller only when it adds a frame the rows above don't already show. */
function showCaller(kind: HangKind): boolean {
  const { callerFrame } = kind;
  return (
    callerFrame >= 0 &&
    callerFrame !== kind.areaFrame &&
    callerFrame !== kind.mechanismFrame &&
    callerFrame !== kind.activityFrame
  );
}

function topPlatform(stats: Record<string, number>): { os: string; share: number } | null {
  let total = 0;
  let top: [string, number] | null = null;
  for (const [os, count] of Object.entries(stats)) {
    total += count;
    if (!top || count > top[1]) {
      top = [os, count];
    }
  }
  return top && total > 0 ? { os: top[0], share: top[1] / total } : null;
}

/** Which summary rows point at each stack depth, for marking the stack. */
export function evidenceMarks(kind: HangKind): Map<number, string[]> {
  const marks = new Map<number, string[]>();
  const add = (depth: number, label: string) => {
    if (depth >= 0) {
      marks.set(depth, [...(marks.get(depth) ?? []), label]);
    }
  };
  add(kind.mechanismFrame, "mechanism");
  if (kind.area) {
    add(kind.areaFrame, "area");
  }
  if (kind.activity) {
    add(kind.activityFrame, "during");
  }
  if (showCaller(kind)) {
    add(kind.callerFrame, "caller");
  }
  return marks;
}
