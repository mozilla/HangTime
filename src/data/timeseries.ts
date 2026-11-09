/**
 * The timeseries artifact produced by the secondary `bhr-timeseries` job:
 * per-signature daily hang ms/count over a rolling window, for the top-M
 * signatures. Loaded once and indexed by stable signature key so a selected
 * hang (or a bug merging several stacks) can be joined to its history.
 */

import {
  canonicalKeyFromFrames,
  memberStackTotals,
  shapeKey,
  shapeKeyFromFrames,
  shapeName,
} from "@/processing/signatureKey";
import type { HangSignature, KnownBug, ProcessedProfile } from "@/processing/types";
import type { ThreadKind } from "./dataSource";

const DATA_BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? "data";

/**
 * Distinct affected users over each trailing window, keyed by the roll-up's
 * window labels. Present only when the artifact was built from daily runs that
 * carried client metrics.
 */
export interface WindowCounts {
  d7: number;
  d28: number;
  d365: number;
}

/** One signature's daily series; `ms`/`count`/`affected` run parallel to `dates`. */
export interface TimeseriesSignature {
  /** Representative stack as `[funcName, libName]` pairs, leaf -> root. */
  frames: [string, string][];
  totalMs: number;
  totalCount: number;
  /**
   * Hang ms on each day. `null` means no data for that day rather than zero:
   * either the day has no artifact, or the roll-up truncated its per-day top-N
   * and this signature fell below the cut. A real 0 means the day kept every
   * signature it saw and this one did not hang.
   */
  ms: (number | null)[];
  count: (number | null)[];
  /** Distinct users affected on each day (absent without client metrics). */
  affected?: (number | null)[];
  /** Distinct users affected over 7/28/365 days (absent without client metrics). */
  affectedUsers?: WindowCounts;
  /** affectedUsers / total window users, in [0, 1] (absent without client metrics). */
  affectedPct?: WindowCounts;
}

export interface TimeseriesArtifact {
  uuid: string;
  windowStartDate: string;
  windowEndDate: string;
  topCount: number;
  /** Ordered build dates ("20260401") forming the shared x-axis. */
  dates: string[];
  signatures: TimeseriesSignature[];
  /**
   * Distinct clients seen in each window, the shared denominator. These are
   * the clients that sent hang reports, not every Firefox or Nightly user.
   */
  totalUsers?: WindowCounts;
  /** Distinct hang-reporting clients on each day, parallel to `dates` (daily denominator). */
  totalAffected?: (number | null)[];
}

/** The trailing windows the roll-up reports, in ascending length. */
export const AFFECTED_WINDOWS = [
  { key: "d7" as const, days: 7, label: "7-Day" },
  { key: "d28" as const, days: 28, label: "28-Day" },
  { key: "d365" as const, days: 365, label: "365-Day" },
];

/** A signature's affected-user share resolved for one trailing window. */
export interface AffectedWindow {
  key: keyof WindowCounts;
  label: string;
  users: number;
  totalUsers: number;
  /** users / totalUsers, in [0, 1]. */
  pct: number;
}

/** Affected-user shares across all windows for a (possibly merged) signature. */
export interface ResolvedAffected {
  windows: AffectedWindow[];
  /**
   * True when more than one member contributed. Per-member user sets cannot be
   * unioned from published counts, so the totals are summed as an upper bound.
   */
  approximate: boolean;
}

/** Which metric a series carries. */
export type Metric = "ms" | "count";

/** A single contributing stack's series, resolved for charting. */
export interface MemberSeries {
  key: string;
  /** Leaf function name, for the legend. */
  label: string;
  frames: [string, string][];
  ms: (number | null)[];
  count: (number | null)[];
  totalMs: number;
  totalCount: number;
}

/** Resolved series for a (possibly bug-merged) signature. */
export interface ResolvedSeries {
  dates: string[];
  /** Bug-tag cohort persists independently of which stacks appear on the viewed build. */
  association?: { bugId: number; tags: string[]; stacks: number };
  /**
   * Element-wise sum across all present members. `affected` is present only
   * when the artifact carried client metrics; for a bug-merged signature it is
   * a per-member sum (an upper bound, since day sketches aren't unioned here).
   */
  total: {
    ms: (number | null)[];
    count: (number | null)[];
    affected?: (number | null)[];
  };
  /** Distinct users across all signatures on each day (daily denominator). */
  totalAffected?: (number | null)[];
  /**
   * Whether each day carries data for any tracked signature. A signature's
   * null on a day that has data means it fell below the roll-up's per-day cut;
   * on a day without data, nothing was recorded at all. Trends tell the two
   * apart (see trend.ts).
   */
  dayHasData: boolean[];
  /** Present member series, sorted by descending total ms. */
  members: MemberSeries[];
  /**
   * How much of the hang, on the build it was resolved for, the history
   * follows: the member stacks whose shape it tracks, and their share of the
   * hang's time. A bug folds in many stacks and the history keeps only the
   * top few hundred, so its days are often a partial sum.
   */
  coverage: { stacks: number; totalStacks: number; share: number };
  /** Legacy fill metadata; published-only history resolution leaves this null. */
  filledDate: string | null;
}

export class TimeseriesIndex {
  readonly dates: string[];
  readonly totalUsers: WindowCounts | undefined;
  readonly totalAffected: (number | null)[] | undefined;
  /** Whether each day has data for any tracked signature; see ResolvedSeries. */
  readonly dayHasData: boolean[];
  /**
   * Tracked signatures by stack shape, largest first. The history is keyed by
   * the exact stack, which a build can rename without changing the code path
   * (a renumbered lambda, an edited JS file's line numbers); joining by shape
   * keeps a hang's history across those builds.
   */
  private readonly byShape = new Map<string, TimeseriesSignature[]>();
  /** Shaped leaf frames of the tracked signatures, to skip the rest cheaply. */
  private readonly leaves = new Set<string>();
  /** Compact stack key -> shape, for stacks whose shape this index tracks. */
  private shapeByStack = new Map<string, string>();
  private boundTo: ProcessedProfile | null = null;
  private bugRules: Map<string, KnownBug> | undefined;
  private readonly historyByBug = new Map<number, TimeseriesSignature[]>();
  private readonly shapesByBug = new Map<number, Set<string>>();

  constructor(artifact: TimeseriesArtifact) {
    this.dates = artifact.dates;
    this.totalUsers = artifact.totalUsers;
    this.totalAffected = artifact.totalAffected;
    this.dayHasData = new Array<boolean>(artifact.dates.length).fill(false);
    for (const sig of artifact.signatures) {
      const shape = shapeKeyFromFrames(sig.frames);
      const group = this.byShape.get(shape);
      if (group) {
        group.push(sig);
      } else {
        this.byShape.set(shape, [sig]);
      }
      const leaf = sig.frames[0];
      if (leaf) {
        this.leaves.add(`${shapeName(leaf[0], leaf[1])}\u001f${leaf[1]}`);
      }
      sig.ms.forEach((value, i) => {
        if (value != null) {
          this.dayHasData[i] = true;
        }
      });
    }
    for (const group of this.byShape.values()) {
      group.sort((a, b) => b.totalMs - a.totalMs);
    }
  }

  /** Apply the same literal tags, first match within the innermost frame, as
   * daily bug merging. This cohort depends on bug identity, not today's stacks. */
  setBugs(bugs: Map<string, KnownBug> | undefined): void {
    if (bugs === this.bugRules) return;
    this.bugRules = bugs;
    this.historyByBug.clear();
    this.shapesByBug.clear();
    if (!bugs?.size) return;
    const escape = (s: string) => s.replace(/[[\]{}()*+?.\\^$|]/g, "\\$&");
    const pattern = [...bugs.keys()].map(escape).join("|");
    if (!pattern) return;
    const matcher = new RegExp(pattern);
    for (const [shape, group] of this.byShape) for (const sig of group) {
      for (const [name] of sig.frames) {
        const match = name.match(matcher);
        const bug = match ? bugs.get(match[0]) : undefined;
        if (!bug) continue;
        const cohort = this.historyByBug.get(bug.id) ?? [];
        cohort.push(sig); this.historyByBug.set(bug.id, cohort);
        const shapes = this.shapesByBug.get(bug.id) ?? new Set<string>();
        shapes.add(shape); this.shapesByBug.set(bug.id, shapes);
        break;
      }
    }
  }

  /**
   * Map a processed profile's compact stack keys onto this index.
   *
   * The worker keys signatures by funcTable indices rather than by the frames
   * themselves, because shipping ~158k frame keys back exhausts memory. Only a
   * few hundred stacks are tracked here, so rather than key every stack we
   * take those whose leaf frame appears in this index at all and work out the
   * shape of that handful. Idempotent; later calls are no-ops.
   */
  bind(profile: ProcessedProfile): void {
    if (this.boundTo === profile) {
      return;
    }
    const { funcNames, libNames } = profile;
    const shapeByStack = new Map<string, string>();
    const consider = (stackKey: string) => {
      if (shapeByStack.has(stackKey)) {
        return;
      }
      const frameKeys = stackKey.split(",").map(Number);
      const leaf = frameKeys[0];
      if (leaf === undefined) {
        return;
      }
      const lib = libNames[leaf];
      if (!this.leaves.has(`${shapeName(funcNames[leaf], lib)}\u001f${lib}`)) {
        return;
      }
      const shape = shapeKey(frameKeys, funcNames, libNames);
      if (this.byShape.has(shape)) {
        shapeByStack.set(stackKey, shape);
      }
    };
    for (const sig of profile.signatures) {
      for (const stackKey of sig.memberStackKeys ?? [sig.stackKey]) {
        consider(stackKey);
      }
    }
    this.shapeByStack = shapeByStack;
    this.boundTo = profile;
  }

  /** Current-build coverage without constructing hundreds of historical day arrays. */
  coverageForSignature(signature: HangSignature): ResolvedSeries["coverage"] {
    const stacks = memberStackTotals(signature);
    const trackedShapes = signature.knownBug && this.bugRules
      ? this.shapesByBug.get(signature.knownBug.id) ?? new Set<string>()
      : this.byShape;
    let totalMs = 0;
    let coveredMs = 0;
    let coveredStacks = 0;
    for (const stack of stacks) {
      totalMs += stack.ms;
      const shape = this.shapeByStack.get(stack.key);
      if (shape !== undefined && trackedShapes.has(shape)) {
        coveredMs += stack.ms;
        coveredStacks++;
      }
    }
    return { stacks: coveredStacks, totalStacks: stacks.length, share: totalMs > 0 ? coveredMs / totalMs : 0 };
  }

  /**
   * Select history independently of the viewed build for tagged bugs. Use the
   * same cohort for hang totals, composition and affected-client metrics.
   */
  private trackedForSignature(signature: HangSignature): TimeseriesSignature[] {
    if (signature.knownBug && this.bugRules) {
      return this.historyByBug.get(signature.knownBug.id) ?? [];
    }
    const shapes = new Set<string>();
    for (const key of signature.memberStackKeys ?? [signature.stackKey]) {
      const shape = this.shapeByStack.get(key);
      if (shape !== undefined) shapes.add(shape);
    }
    return [...shapes].flatMap((shape) => this.byShape.get(shape)!);
  }

  /**
   * Resolve a bug's historical tag cohort, or an untagged stack's shape history.
   * A bug's history survives zero overlap with the bound build. Requires `bind`
   * and `setBugs` for bug association.
   *
   * Each exact stored stack contributes once. Never fill a missing historical
   * value from the viewed daily profile: doing so makes a past bar change
   * when selecting another build, and may mix a partial cohort with a full day.
   */
  resolveSignature(signature: HangSignature): ResolvedSeries | null {
    const present = this.trackedForSignature(signature);
    if (present.length === 0) return null;
    const associated = !!signature.knownBug && !!this.bugRules;
    const members = present.map(memberSeries).sort((a, b) => b.totalMs - a.totalMs);
    const series = this.seriesFrom(members, present);
    if (associated && signature.knownBug) series.association = {
      bugId: signature.knownBug.id, tags: signature.knownBug.signatures, stacks: present.length,
    };
    series.coverage = this.coverageForSignature(signature);
    return series;
  }

  /**
   * Resolve the affected-user share over each trailing window for a
   * signature. Returns null when the artifact carries no client metrics or
   * none of its stacks are tracked. For several contributing signatures (a
   * bug, or one code path renamed across builds) the per-window user counts
   * are summed rather than unioned -- the published artifact keeps only
   * counts, not the sketches needed to union them -- so the result is flagged
   * approximate (an upper bound).
   */
  resolveAffectedSignature(signature: HangSignature): ResolvedAffected | null {
    if (!this.totalUsers) {
      return null;
    }
    const present = this.trackedForSignature(signature)
      .filter((sig) => !!sig.affectedUsers);
    if (present.length === 0) {
      return null;
    }

    const windows = AFFECTED_WINDOWS.map(({ key, label }) => {
      const users = present.reduce((sum, sig) => sum + sig.affectedUsers![key], 0);
      const totalUsers = this.totalUsers![key];
      return {
        key,
        label,
        users,
        totalUsers,
        pct: totalUsers > 0 ? Math.min(users / totalUsers, 1) : 0,
      };
    });
    return { windows, approximate: present.length > 1 };
  }

  /** Sum member series into a resolved series. */
  private seriesFrom(members: MemberSeries[], present: TimeseriesSignature[]): ResolvedSeries {
    const n = this.dates.length;
    // Sum only the days we actually have. A day is null in the total when
    // *every* contributing member is null for it, which for the usual
    // single-member series just means this signature has no data that day.
    // When some members have data and others do not, the sum of the known ones
    // is still the best available answer, so it beats propagating null.
    const sumDay = (columns: ((number | null)[] | undefined)[]) =>
      Array.from({ length: n }, (_, i) => {
        let acc: number | null = null;
        for (const column of columns) {
          const value = column?.[i];
          if (value != null) {
            acc = (acc ?? 0) + value;
          }
        }
        return acc;
      });

    const total: ResolvedSeries["total"] = {
      ms: sumDay(members.map((m) => m.ms)),
      count: sumDay(members.map((m) => m.count)),
    };
    total.affected = present.some((sig) => sig.affected)
      ? this.dates.map((_, i) => present.every(sig => sig.affected?.[i] != null)
          ? present.reduce((sum, sig) => sum + sig.affected![i]!, 0) : null)
      : undefined;
    return {
      dates: this.dates,
      total,
      totalAffected: this.totalAffected,
      dayHasData: this.dayHasData,
      members,
      coverage: { stacks: members.length, totalStacks: members.length, share: 1 },
      filledDate: null,
    };
  }
}

function memberSeries(sig: TimeseriesSignature): MemberSeries {
  return {
    key: canonicalKeyFromFrames(sig.frames),
    label: sig.frames[0]?.[0] ?? "(root)",
    frames: sig.frames,
    ms: sig.ms,
    count: sig.count,
    totalMs: sig.totalMs,
    totalCount: sig.totalCount,
  };
}

export async function fetchTimeseries(thread: ThreadKind): Promise<TimeseriesIndex> {
  const url = `${DATA_BASE}/hangs_timeseries_${thread}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return new TimeseriesIndex((await res.json()) as TimeseriesArtifact);
}
