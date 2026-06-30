const store = new Map();

const DEFAULT_TTL = 60;

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlSeconds = DEFAULT_TTL) {
  store.set(key, { value, expiry: Date.now() + ttlSeconds * 1000 });
}

function del(key) {
  store.delete(key);
}

function delPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export { get, set, del, delPrefix };
