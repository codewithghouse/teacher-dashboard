/**
 * syncClaims.ts
 * Calls the `syncUserClaims` Cloud Function to populate Firebase custom claims
 * ({ schoolId, role, branchId }) on the user's ID token, then force-refreshes
 * the token so Firestore security rules see the new claims.
 */
import { httpsCallable } from "firebase/functions";
import type { User } from "firebase/auth";
import { functions } from "./firebase";

type SyncClaimsResult = {
  role: string;
  schoolId: string | null;
  branchId?: string | null;
};

export async function syncClaimsAndRefreshToken(user: User): Promise<SyncClaimsResult | null> {
  try {
    // Migrated 2026-05-18 to syncUserClaimsV2 — legacy function stuck on deleted India SA.
    const call = httpsCallable<unknown, SyncClaimsResult>(functions, "syncUserClaimsV2");
    const res = await call({});
    await user.getIdToken(true);
    return res.data ?? null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[syncClaims] failed:", message);
    return null;
  }
}