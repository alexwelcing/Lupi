// In-memory Firestore stand-in covering the surface app.mjs uses.
export function fakeFirestore() {
  const store = new Map();
  function docRef(path) {
    return {
      async get() {
        const data = store.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      async set(data, opts) {
        store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data);
      },
    };
  }
  return {
    _store: store,
    collection(name) {
      return { doc: (id) => docRef(`${name}/${id}`) };
    },
    async runTransaction(fn) {
      const writes = [];
      const result = await fn({
        get: (ref) => ref.get(),
        set: (ref, data, opts) => writes.push(() => ref.set(data, opts)),
      });
      if (this._failNextTransaction) {
        this._failNextTransaction = false;
        throw new Error("simulated transaction failure");
      }
      for (const write of writes) await write();
      return result;
    },
  };
}
