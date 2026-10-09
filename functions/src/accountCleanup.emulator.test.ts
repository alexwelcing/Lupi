/**
 * purgeUserData against the Firestore emulator: the recursive delete must clear
 * trophies stored under a users/{uid} document that was never written, and
 * leave every other user alone. Runs only when FIRESTORE_EMULATOR_HOST is set
 * (npm run test:emulator).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { purgeUserData } from './accountCleanup';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!EMULATOR)('purgeUserData (emulator)', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    // Its own project id: the rules suite clears demo-lupi between its tests.
    app = initializeApp({ projectId: 'demo-lupi-purge' }, 'purge-test');
    db = getFirestore(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it('deletes one user subtree and nothing else', async () => {
    const batch = db.batch();
    for (const path of [
      'users/alice/trophies/t-1',
      'users/alice/trophies/t-2',
      'users/bob/trophies/t-1',
    ]) {
      batch.set(db.doc(path), { schema: 'lupi.trophy.v1', deleted: false, payload: {} });
    }
    await batch.commit();

    await purgeUserData('alice', db as never);

    expect((await db.collection('users/alice/trophies').get()).size).toBe(0);
    expect((await db.collection('users/bob/trophies').get()).size).toBe(1);
    // Idempotent: a retried event finds nothing and succeeds.
    await expect(purgeUserData('alice', db as never)).resolves.toBe('users/alice');
  });
});
