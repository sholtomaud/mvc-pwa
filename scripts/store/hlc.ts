import { loadJSON, saveJSON } from './storage';

/**
 * Hybrid Logical Clock (Kulkarni et al., 2014).
 *
 * Produces timestamps that are (a) close to physical time, (b) strictly
 * monotonic on a single node even when the wall clock stalls or jumps
 * backwards, and (c) totally ordered across nodes once combined with a node
 * id tiebreaker. This is the causal metadata that makes offline replicas
 * mergeable: every mutation is stamped at write time, so when a second
 * device eventually syncs, per-field last-writer-wins comparisons are
 * well-defined instead of guesswork.
 *
 * Timestamps are serialized as fixed-width strings —
 *   "<millis:15>:<counter:6>:<nodeId>"
 * — so plain lexicographic comparison IS causal comparison. That keeps the
 * merge logic dependency-free and the persisted records human-inspectable.
 */

const MILLIS_WIDTH = 15;
const COUNTER_WIDTH = 6;
const MAX_COUNTER = 10 ** COUNTER_WIDTH - 1;

export function compareTimestamps(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The later of two serialized timestamps (ties resolved by node id). */
export function laterTimestamp(a: string, b: string): string {
  return compareTimestamps(a, b) >= 0 ? a : b;
}

interface ParsedTimestamp {
  millis: number;
  counter: number;
  nodeId: string;
}

function pack(millis: number, counter: number, nodeId: string): string {
  return [
    String(millis).padStart(MILLIS_WIDTH, '0'),
    String(counter).padStart(COUNTER_WIDTH, '0'),
    nodeId
  ].join(':');
}

export function parseTimestamp(ts: string): ParsedTimestamp | null {
  const parts = ts.split(':');
  if (parts.length < 3) return null;
  const millis = Number(parts[0]);
  const counter = Number(parts[1]);
  const nodeId = parts.slice(2).join(':');
  if (!Number.isFinite(millis) || !Number.isFinite(counter) || !nodeId) return null;
  return { millis, counter, nodeId };
}

export function isValidTimestamp(ts: unknown): ts is string {
  return typeof ts === 'string' && parseTimestamp(ts) !== null;
}

export class HLC {
  private lastMillis = 0;
  private counter = 0;

  constructor(
    readonly nodeId: string,
    private readonly physicalNow: () => number = Date.now
  ) {}

  /** Stamp a local event. Strictly monotonic per node. */
  now(): string {
    const physical = this.physicalNow();
    if (physical > this.lastMillis) {
      this.lastMillis = physical;
      this.counter = 0;
    } else if (this.counter < MAX_COUNTER) {
      this.counter += 1;
    } else {
      // Counter exhausted within one millisecond: step logical time forward.
      this.lastMillis += 1;
      this.counter = 0;
    }
    return pack(this.lastMillis, this.counter, this.nodeId);
  }

  /**
   * Observe a remote timestamp (called during merge). Advances the local
   * clock past it so every subsequent local write is causally "after"
   * everything this node has seen.
   */
  receive(remoteTs: string): void {
    const remote = parseTimestamp(remoteTs);
    if (!remote) return;
    const physical = this.physicalNow();

    if (physical > this.lastMillis && physical > remote.millis) {
      this.lastMillis = physical;
      this.counter = 0;
    } else if (remote.millis > this.lastMillis) {
      this.lastMillis = remote.millis;
      this.counter = remote.counter + 1;
    } else if (remote.millis === this.lastMillis) {
      this.counter = Math.max(this.counter, remote.counter) + 1;
    } else {
      this.counter += 1;
    }
  }
}

function randomNodeId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID().slice(0, 8);
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

/**
 * Each browser install (replica) gets one stable node id, generated on
 * first use and persisted. Falls back to an ephemeral id where storage is
 * unavailable — correctness degrades gracefully to "new replica per run".
 */
export function createDefaultHLC(): HLC {
  const KEY = 'hlc-node-id';
  let nodeId = loadJSON<string | null>(KEY, null);
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    nodeId = randomNodeId();
    saveJSON(KEY, nodeId);
  }
  return new HLC(nodeId);
}
