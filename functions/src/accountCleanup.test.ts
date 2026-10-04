import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock firebase deps so the trigger can be exercised without a project. vi.mock
// is hoisted above imports, so the shared fakes are hoisted with it.
const { recursiveDelete, docRefs, fakeDb, trigger } = vi.hoisted(() => {
  const recursiveDelete = vi.fn(async (_ref: unknown) => undefined);
  const docRefs: string[] = [];
  const fakeDb = {
    doc: (path: string) => {
      docRefs.push(path);
      return { path };
    },
    recursiveDelete,
  };
  const trigger: {
    onDelete?: (user: { uid: string }) => Promise<unknown>;
    failurePolicy?: boolean;
  } = {};
  return { recursiveDelete, docRefs, fakeDb, trigger };
});

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => fakeDb }));
vi.mock('firebase-functions/v2', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v1', () => ({
  runWith: (options: { failurePolicy?: boolean }) => {
    trigger.failurePolicy = options.failurePolicy;
    return {
      auth: {
        user: () => ({
          onDelete: (handler: (user: { uid: string }) => Promise<unknown>) => {
            trigger.onDelete = handler;
            return handler;
          },
        }),
      },
    };
  },
}));

import { purgeUserData, userDataPath } from './accountCleanup';

afterEach(() => {
  vi.clearAllMocks();
  docRefs.length = 0;
});

describe('userDataPath', () => {
  it('maps a Firebase uid to its users document', () => {
    expect(userDataPath('kZ3x9QaB1cTq0V2nM8sLr4Yw7Ee2')).toBe('users/kZ3x9QaB1cTq0V2nM8sLr4Yw7Ee2');
    expect(userDataPath('a'.repeat(128))).toBe(`users/${'a'.repeat(128)}`);
  });

  it('refuses uids that would address some other path', () => {
    for (const uid of ['', 'alice/trophies/t-1', '.', '..', '__name__', 'a'.repeat(129), 42, null]) {
      expect(userDataPath(uid)).toBeNull();
    }
  });
});

describe('purgeUserData', () => {
  it('recursively deletes the user subtree', async () => {
    await expect(purgeUserData('alice')).resolves.toBe('users/alice');
    expect(docRefs).toEqual(['users/alice']);
    expect(recursiveDelete).toHaveBeenCalledWith({ path: 'users/alice' });
  });

  it('touches nothing for an unaddressable uid', async () => {
    await expect(purgeUserData('alice/trophies')).resolves.toBeNull();
    expect(recursiveDelete).not.toHaveBeenCalled();
  });

  it('propagates a Firestore failure so the trigger can be retried', async () => {
    recursiveDelete.mockRejectedValueOnce(new Error('unavailable'));
    await expect(purgeUserData('alice')).rejects.toThrow('unavailable');
  });
});

describe('deleteUserData trigger', () => {
  it('purges the deleted user on the Auth delete event, with retries', async () => {
    expect(trigger.failurePolicy).toBe(true);
    expect(trigger.onDelete).toBeTypeOf('function');
    await trigger.onDelete?.({ uid: 'bob' });
    expect(recursiveDelete).toHaveBeenCalledWith({ path: 'users/bob' });
  });
});
