import { describe, expect, it } from 'vitest';
import { compareTimestamps, HLC, isValidTimestamp, parseTimestamp } from '../../scripts/store/hlc';

/** A controllable wall clock. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; }, set: (ms: number) => { t = ms; } };
}

describe('HLC', () => {
  it('produces strictly increasing timestamps even when wall time is frozen', () => {
    const clock = fakeClock();
    const hlc = new HLC('node-a', clock.now);
    const stamps = Array.from({ length: 100 }, () => hlc.now());
    const sorted = [...stamps].sort(compareTimestamps);
    expect(stamps).toEqual(sorted);
    expect(new Set(stamps).size).toBe(100);
  });

  it('stays monotonic when the wall clock jumps backwards', () => {
    const clock = fakeClock(2_000_000);
    const hlc = new HLC('node-a', clock.now);
    const before = hlc.now();
    clock.set(1_000_000); // clock skew: 1000s backwards
    const after = hlc.now();
    expect(compareTimestamps(after, before)).toBeGreaterThan(0);
  });

  it('resets the counter when physical time advances', () => {
    const clock = fakeClock();
    const hlc = new HLC('node-a', clock.now);
    hlc.now(); hlc.now(); hlc.now();
    clock.advance(5);
    expect(parseTimestamp(hlc.now())!.counter).toBe(0);
  });

  it('receive() advances the clock past a remote timestamp from the future', () => {
    const clockA = fakeClock(1_000_000);
    const clockB = fakeClock(9_000_000); // replica B's clock is far ahead
    const a = new HLC('node-a', clockA.now);
    const b = new HLC('node-b', clockB.now);

    const remote = b.now();
    a.receive(remote);
    const local = a.now();
    expect(compareTimestamps(local, remote)).toBeGreaterThan(0);
  });

  it('orders lexicographically === causally, with node id as tiebreaker', () => {
    const clock = fakeClock();
    const a = new HLC('node-a', clock.now);
    const b = new HLC('node-b', clock.now);
    const ta = a.now();
    const tb = b.now(); // identical millis+counter, differs only by node id
    expect(compareTimestamps(ta, tb)).toBeLessThan(0);
    expect([tb, ta].sort(compareTimestamps)).toEqual([ta, tb]);
  });

  it('validates and rejects malformed timestamps', () => {
    const hlc = new HLC('node-a');
    expect(isValidTimestamp(hlc.now())).toBe(true);
    expect(isValidTimestamp('garbage')).toBe(false);
    expect(isValidTimestamp(42)).toBe(false);
    expect(() => hlc.receive('garbage')).not.toThrow();
  });
});
