/**
 * Account deletion backstop for the native app's trophy case.
 *
 * The app deletes its own trophies, revokes Sign in with Apple and then deletes
 * the account (docs/ar/account-and-sync.md). A crash or a lost connection
 * between those steps, or a delete from the Firebase console, would leave
 * users/{uid} behind. When Firebase Auth deletes a user, this clears the whole
 * subtree, so nothing outlives the account.
 *
 * 1st-gen Auth trigger: firebase-functions 6 has no 2nd-gen user-deleted event
 * (`onUserDeleted` arrives in later majors). Bulk `deleteUsers()` fires no
 * event, so admin bulk deletes must clean up users/{uid} themselves.
 */
import * as functionsV1 from 'firebase-functions/v1';
import { logger } from 'firebase-functions/v2';
import { getFirestore } from 'firebase-admin/firestore';

const MAX_UID_LENGTH = 128;

/**
 * The Firestore path that holds everything a user owns, or null when the uid
 * cannot name a single document. A custom-token uid may contain '/', which
 * would point the recursive delete at some other path; the rules key data by
 * one path segment, so such a user can own nothing there.
 */
export function userDataPath(uid: unknown): string | null {
  if (typeof uid !== 'string') return null;
  if (uid.length === 0 || uid.length > MAX_UID_LENGTH) return null;
  if (uid.includes('/') || uid === '.' || uid === '..' || /^__.*__$/.test(uid)) return null;
  return `users/${uid}`;
}

interface RecursiveDeleteStore {
  doc(path: string): unknown;
  recursiveDelete(ref: never): Promise<void>;
}

/** Deletes users/{uid} and every subcollection under it. Idempotent. */
export async function purgeUserData(
  uid: unknown,
  db: RecursiveDeleteStore = getFirestore() as unknown as RecursiveDeleteStore,
): Promise<string | null> {
  const path = userDataPath(uid);
  if (!path) {
    logger.warn('user_data_purge_skipped', { reason: 'unaddressable_uid' });
    return null;
  }
  // recursiveDelete also clears subcollections under a parent document that
  // was never written, which is how trophies are stored.
  await db.recursiveDelete(db.doc(path) as never);
  logger.info('user_data_purged', { uid });
  return path;
}

// Retried on failure: the purge is idempotent, and a transient Firestore error
// must not leave a deleted user's trophies behind.
export const deleteUserData = functionsV1
  .runWith({ failurePolicy: true })
  .auth.user()
  .onDelete(async (user) => {
    await purgeUserData(user.uid);
  });
