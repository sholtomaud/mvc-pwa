import { describe, expect, it } from 'vitest';
import { HLC } from '../../scripts/store/hlc';
import { isLive, mergeRecord, sanitizeRecord, type TodoRecord } from '../../scripts/store/todo-record';

function makeRecord(hlc: HLC, id: string, text: string): TodoRecord {
  return {
    id,
    created: hlc.now(),
    text: { value: text, ts: hlc.now() },
    complete: { value: false, ts: hlc.now() },
    deleted: { value: false, ts: hlc.now() }
  };
}

let t = 1_000_000;
const clock = () => t++;

describe('mergeRecord', () => {
  it('keeps the causally-latest value per field', () => {
    const a = new HLC('node-a', clock);
    const b = new HLC('node-b', clock);
    const base = makeRecord(a, 'x', 'original');

    const editedOnA: TodoRecord = { ...base, text: { value: 'edited on A', ts: a.now() } };
    const editedOnB: TodoRecord = { ...base, text: { value: 'edited on B', ts: b.now() } };

    // B's edit is later -> B wins, in BOTH merge directions.
    expect(mergeRecord(editedOnA, editedOnB).text.value).toBe('edited on B');
    expect(mergeRecord(editedOnB, editedOnA).text.value).toBe('edited on B');
  });

  it('concurrent edits to different fields both survive', () => {
    const a = new HLC('node-a', clock);
    const b = new HLC('node-b', clock);
    const base = makeRecord(a, 'x', 'shared');

    const textOnA: TodoRecord = { ...base, text: { value: 'renamed', ts: a.now() } };
    const doneOnB: TodoRecord = { ...base, complete: { value: true, ts: b.now() } };

    const merged = mergeRecord(textOnA, doneOnB);
    expect(merged.text.value).toBe('renamed');
    expect(merged.complete.value).toBe(true);
  });

  it('a tombstone is not resurrected by a stale concurrent edit', () => {
    const a = new HLC('node-a', clock);
    const b = new HLC('node-b', clock);
    const base = makeRecord(a, 'x', 'doomed');

    const editedOnA: TodoRecord = { ...base, text: { value: 'late edit', ts: a.now() } };
    const deletedOnB: TodoRecord = { ...base, deleted: { value: true, ts: b.now() } };

    const merged = mergeRecord(editedOnA, deletedOnB);
    expect(isLive(merged)).toBe(false);
    // ...but the edit is not lost either: an explicit undelete would reveal it.
    expect(merged.text.value).toBe('late edit');
  });

  it('is idempotent and commutative', () => {
    const a = new HLC('node-a', clock);
    const r1 = makeRecord(a, 'x', 'one');
    const r2: TodoRecord = { ...r1, text: { value: 'two', ts: a.now() } };

    expect(mergeRecord(r1, r1)).toEqual(r1);
    expect(mergeRecord(r1, r2)).toEqual(mergeRecord(r2, r1));
    expect(mergeRecord(mergeRecord(r1, r2), r2)).toEqual(mergeRecord(r1, r2));
  });
});

describe('sanitizeRecord', () => {
  it('accepts well-formed records and rejects everything else', () => {
    const a = new HLC('node-a', clock);
    const good = makeRecord(a, 'x', 'fine');
    expect(sanitizeRecord(good)).toEqual(good);
    expect(sanitizeRecord(null)).toBeNull();
    expect(sanitizeRecord({ id: 'x' })).toBeNull();
    expect(sanitizeRecord({ ...good, text: { value: 'no ts' } })).toBeNull();
    expect(sanitizeRecord({ ...good, complete: { value: 'yes', ts: good.created } })).toBeNull();
  });
});
