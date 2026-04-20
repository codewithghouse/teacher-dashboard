/**
 * auditedWrites.ts
 * Thin wrappers around Firestore write operations that inject `_lastModifiedBy`
 * and `_lastModifiedAt` on every write. There is no server-side trigger that
 * back-fills these fields, so callers MUST route writes through these wrappers
 * to preserve the audit trail.
 */
import {
  addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  type CollectionReference, type DocumentReference,
  type DocumentData, type WithFieldValue, type SetOptions, type UpdateData,
} from "firebase/firestore";
import { auth } from "./firebase";

function actor(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    // Writing without an authenticated user is almost never intentional and
    // will be rejected by Firestore rules. Fail fast with a clear message
    // rather than stamping `"anonymous"` and hitting a cryptic permission error.
    throw new Error("[auditedWrites] No authenticated user; refusing to write.");
  }
  return uid;
}

export function auditedAdd<T extends DocumentData>(
  ref: CollectionReference<T>,
  data: WithFieldValue<T>,
) {
  return addDoc(ref, {
    ...data,
    _lastModifiedBy: actor(),
    _lastModifiedAt: serverTimestamp(),
  } as WithFieldValue<T>);
}

export function auditedSet<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: WithFieldValue<T>,
  options?: SetOptions,
) {
  const payload = {
    ...data,
    _lastModifiedBy: actor(),
    _lastModifiedAt: serverTimestamp(),
  } as WithFieldValue<T>;
  return options ? setDoc(ref, payload, options) : setDoc(ref, payload);
}

export function auditedUpdate<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: UpdateData<T>,
) {
  return updateDoc(ref, {
    ...data,
    _lastModifiedBy: actor(),
    _lastModifiedAt: serverTimestamp(),
  } as UpdateData<T>);
}

// NOTE: Firestore deletes cannot carry a payload, so we cannot stamp actor/
// timestamp on the deleted doc itself. There is also no server-side onDelete
// trigger in this project. If a full audit trail of deletions is required,
// prefer a soft-delete pattern in the calling code (set `deletedBy`/`deletedAt`
// via auditedUpdate) instead of hard-deleting. We still record the actor
// client-side for local debugging.
export function auditedDelete<T extends DocumentData>(ref: DocumentReference<T>) {
  const by = actor();
  console.info("[auditedDelete]", { path: ref.path, by });
  return deleteDoc(ref);
}