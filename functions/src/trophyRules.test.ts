/**
 * Firestore rules for the trophy case (users/{uid}/trophies/{trophyId}).
 *
 * These need the Firestore emulator, so they run only when
 * FIRESTORE_EMULATOR_HOST is set and are skipped in the ordinary unit run:
 *
 *   npm run test:emulator     # starts the emulator; the tests load ../firestore.rules
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const RULES = resolve(__dirname, '../../firestore.rules');

function envelope(id: string, overrides: Record<string, unknown> = {}) {
  return {
    schema: 'lupi.trophy.v1',
    id,
    payload: {
      id,
      name: 'Caffeine',
      molecule: { source: 'gallery', id: 'caffeine', formula: 'C8H10N4O2' },
      origin: { kind: 'spawned' },
      look: { scale: 1 },
    },
    deleted: false,
    updatedAt: serverTimestamp(),
    clientUpdatedAt: Timestamp.now(),
    ...overrides,
  };
}

function trophy(db: Firestore, uid: string, id: string) {
  return doc(db, 'users', uid, 'trophies', id);
}

describe.skipIf(!EMULATOR)('trophy rules (emulator)', () => {
  let env: RulesTestEnvironment;
  let alice: Firestore;
  let bob: Firestore;
  let anon: Firestore;

  beforeAll(async () => {
    setLogLevel('error');
    env = await initializeTestEnvironment({
      projectId: 'demo-lupi',
      firestore: { rules: readFileSync(RULES, 'utf8') },
    });
    alice = env.authenticatedContext('alice').firestore() as unknown as Firestore;
    bob = env.authenticatedContext('bob').firestore() as unknown as Firestore;
    anon = env.unauthenticatedContext().firestore() as unknown as Firestore;
  });

  beforeEach(async () => {
    await env.clearFirestore();
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('lets the owner create, read, list and query their trophies', async () => {
    await assertSucceeds(setDoc(trophy(alice, 'alice', 't-1'), envelope('t-1')));
    await assertSucceeds(getDoc(trophy(alice, 'alice', 't-1')));
    await assertSucceeds(getDocs(collection(alice, 'users', 'alice', 'trophies')));
    await assertSucceeds(
      getDocs(
        query(
          collection(alice, 'users', 'alice', 'trophies'),
          where('updatedAt', '>', Timestamp.fromMillis(0)),
          orderBy('updatedAt'),
        ),
      ),
    );
  });

  it('lets the owner tombstone, resurrect and hard-delete a trophy', async () => {
    await assertSucceeds(setDoc(trophy(alice, 'alice', 't-1'), envelope('t-1')));
    await assertSucceeds(
      setDoc(trophy(alice, 'alice', 't-1'), envelope('t-1', { deleted: true, payload: {} })),
    );
    await assertSucceeds(setDoc(trophy(alice, 'alice', 't-1'), envelope('t-1')));
    await assertSucceeds(deleteDoc(trophy(alice, 'alice', 't-1')));
  });

  it('keeps other users and signed-out callers out', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alice/trophies/t-1'), {
        ...envelope('t-1'),
        updatedAt: Timestamp.now(),
      });
    });
    await assertFails(getDoc(trophy(bob, 'alice', 't-1')));
    await assertFails(getDocs(collection(bob, 'users', 'alice', 'trophies')));
    await assertFails(setDoc(trophy(bob, 'alice', 't-2'), envelope('t-2')));
    await assertFails(updateDoc(trophy(bob, 'alice', 't-1'), { deleted: true, payload: {} }));
    await assertFails(deleteDoc(trophy(bob, 'alice', 't-1')));
    await assertFails(getDoc(trophy(anon, 'alice', 't-1')));
    await assertFails(setDoc(trophy(anon, 'alice', 't-2'), envelope('t-2')));
  });

  it('opens nothing else under users/{uid}', async () => {
    await assertFails(getDoc(doc(alice, 'users/alice')));
    await assertFails(setDoc(doc(alice, 'users/alice'), { name: 'Alice' }));
    await assertFails(getDoc(doc(alice, 'users/alice/shelves/s-1')));
    await assertFails(setDoc(doc(alice, 'users/alice/shelves/s-1'), { worldMap: 'nope' }));
    await assertFails(
      setDoc(doc(alice, 'users/alice/trophies/t-1/history/h-1'), { note: 'nope' }),
    );
  });

  it('rejects envelopes that break the schema', async () => {
    const id = 't-1';
    const ref = trophy(alice, 'alice', id);
    const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i]));
    const bad: Array<[string, Record<string, unknown>]> = [
      ['client-set updatedAt', envelope(id, { updatedAt: Timestamp.now() })],
      ['wrong schema', envelope(id, { schema: 'lupi.trophy.v2' })],
      ['id mismatch', envelope(id, { id: 't-2' })],
      ['payload not a map', envelope(id, { payload: '{"id":"t-1"}' })],
      ['deleted not a bool', envelope(id, { deleted: 'no' })],
      ['tombstone with content', envelope(id, { deleted: true })],
      ['payload too wide', envelope(id, { payload: tooMany })],
      ['clientUpdatedAt not a timestamp', envelope(id, { clientUpdatedAt: '2026-10-04' })],
      [
        'clientUpdatedAt two hours ahead',
        envelope(id, { clientUpdatedAt: Timestamp.fromMillis(Date.now() + 2 * 3600_000) }),
      ],
      ['extra key', envelope(id, { ownerEmail: 'alice@example.com' })],
    ];
    for (const [, data] of bad) {
      await assertFails(setDoc(ref, data));
    }
    const { clientUpdatedAt: _omit, ...missing } = envelope(id);
    await assertFails(setDoc(ref, missing));
    await assertFails(setDoc(trophy(alice, 'alice', 'bad id!'), envelope('bad id!')));
  });

  it('checks updates against the same schema', async () => {
    const ref = trophy(alice, 'alice', 't-1');
    await assertSucceeds(setDoc(ref, envelope('t-1')));
    // A partial update keeps the old server updatedAt, which is not request.time.
    await assertFails(updateDoc(ref, { 'payload.name': 'Theine' }));
    await assertSucceeds(
      updateDoc(ref, {
        'payload.name': 'Theine',
        updatedAt: serverTimestamp(),
        clientUpdatedAt: Timestamp.now(),
      }),
    );
    await assertFails(updateDoc(ref, { schema: 'lupi.trophy.v0', updatedAt: serverTimestamp() }));
  });
});
