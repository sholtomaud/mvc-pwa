import { isValidTimestamp, laterTimestamp } from './hlc';

/**
 * The persisted, sync-ready shape of a todo.
 *
 * Each mutable field is a last-writer-wins register carrying the HLC
 * timestamp of its last write, and deletion is a tombstone (its own LWW
 * register) rather than removal — both are required for deterministic,
 * lossless merging between replicas. Concurrent edits to DIFFERENT fields
 * of the same todo both survive a merge; concurrent edits to the SAME field
 * resolve to the causally-latest write, with node id as a total-order
 * tiebreaker.
 *
 * Chosen tombstone semantics: `deleted` is independent of the other fields,
 * so an edit made on one replica does not resurrect a todo deleted on
 * another — only an explicitly newer deleted=false would.
 */

export interface LWWRegister<T> {
  value: T;
  ts: string;
}

export interface TodoRecord {
  id: string;
  created: string;
  text: LWWRegister<string>;
  complete: LWWRegister<boolean>;
  deleted: LWWRegister<boolean>;
}

/** The plain view-model shape consumed by components. */
export interface Todo {
  id: string;
  text: string;
  complete: boolean;
}

function newerRegister<T>(a: LWWRegister<T>, b: LWWRegister<T>): LWWRegister<T> {
  return laterTimestamp(a.ts, b.ts) === a.ts ? a : b;
}

/** Deterministic, commutative, idempotent merge of two record versions. */
export function mergeRecord(a: TodoRecord, b: TodoRecord): TodoRecord {
  return {
    id: a.id,
    // `created` is immutable; keep the earlier stamp deterministically.
    created: laterTimestamp(a.created, b.created) === a.created ? b.created : a.created,
    text: newerRegister(a.text, b.text),
    complete: newerRegister(a.complete, b.complete),
    deleted: newerRegister(a.deleted, b.deleted)
  };
}

export function isLive(record: TodoRecord): boolean {
  return !record.deleted.value;
}

export function toTodo(record: TodoRecord): Todo {
  return { id: record.id, text: record.text.value, complete: record.complete.value };
}

function isRegister(raw: unknown, type: 'string' | 'boolean'): raw is LWWRegister<never> {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as LWWRegister<unknown>).value === type &&
    isValidTimestamp((raw as LWWRegister<unknown>).ts)
  );
}

/** Never trust persisted or remote data: accept only well-formed records. */
export function sanitizeRecord(raw: unknown): TodoRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as TodoRecord;
  const valid =
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    isValidTimestamp(r.created) &&
    isRegister(r.text, 'string') &&
    isRegister(r.complete, 'boolean') &&
    isRegister(r.deleted, 'boolean');
  return valid ? r : null;
}
