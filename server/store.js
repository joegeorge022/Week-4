import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const list = (a, n = 40, len = 80) =>
  (Array.isArray(a) ? a : String(a ?? '').split(/[,\n]/))
    .map((x) => clip(x, len))
    .filter(Boolean)
    .slice(0, n);

/** Normalise untrusted person input. */
export function cleanPerson(input = {}) {
  const photo = typeof input.photo === 'string' && input.photo.startsWith('data:image/') ? input.photo : '';
  return {
    name: clip(input.name, 80),
    relation: clip(input.relation, 60),
    years: clip(input.years, 30),
    foods: list(input.foods),
    songs: list(input.songs),
    photo: photo.length <= 1_500_000 ? photo : '',
  };
}

export const MEMORY_SOURCES = ['typed', 'voice', 'ghost'];

export function cleanMemory(input = {}) {
  return {
    text: clip(input.text, 4000),
    source: MEMORY_SOURCES.includes(input.source) ? input.source : 'typed',
  };
}

/* ------------------------------------------------------------------ */
/* File store: one JSON file, atomic writes, serialised through a queue */
/* ------------------------------------------------------------------ */
export class FileStore {
  kind = 'file';

  constructor(dir) {
    this.file = path.join(dir, 'altar.json');
    this.dir = dir;
    this.queue = Promise.resolve();
    this.db = null;
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      this.db = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      this.db = { people: [], memories: [] };
    }
    this.db.people ??= [];
    this.db.memories ??= [];
    return this;
  }

  #persist() {
    this.queue = this.queue.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.db, null, 2));
      await fs.rename(tmp, this.file);
    });
    return this.queue;
  }

  async listPeople() {
    return [...this.db.people].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getPerson(id) {
    return this.db.people.find((p) => p.id === id) ?? null;
  }

  async createPerson(input) {
    const p = { id: uid(), ...cleanPerson(input), createdAt: now() };
    this.db.people.push(p);
    await this.#persist();
    return p;
  }

  async updatePerson(id, input) {
    const p = await this.getPerson(id);
    if (!p) return null;
    Object.assign(p, cleanPerson({ ...p, ...input }));
    await this.#persist();
    return p;
  }

  async deletePerson(id) {
    const before = this.db.people.length;
    this.db.people = this.db.people.filter((p) => p.id !== id);
    this.db.memories = this.db.memories.filter((m) => m.personId !== id);
    await this.#persist();
    return this.db.people.length < before;
  }

  async listMemories(personId) {
    return this.db.memories
      .filter((m) => m.personId === personId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async addMemory(personId, input) {
    const clean = cleanMemory(input);
    if (!clean.text) return null;
    const m = { id: uid(), personId, ...clean, createdAt: now() };
    this.db.memories.push(m);
    await this.#persist();
    return m;
  }

  async deleteMemory(personId, id) {
    const before = this.db.memories.length;
    this.db.memories = this.db.memories.filter((m) => !(m.id === id && m.personId === personId));
    await this.#persist();
    return this.db.memories.length < before;
  }

  async exportAll() {
    return { exportedAt: now(), people: this.db.people, memories: this.db.memories };
  }

  async wipe() {
    this.db = { people: [], memories: [] };
    await this.#persist();
  }

  async close() {
    await this.queue;
  }
}

/* ------------------------------------------------------------------ */
/* MongoDB Atlas store (optional)                                      */
/* ------------------------------------------------------------------ */
export class MongoStore {
  kind = 'mongodb';

  constructor(uri, dbName) {
    this.uri = uri;
    this.dbName = dbName;
  }

  async init() {
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 8000 });
    await this.client.connect();
    const db = this.client.db(this.dbName);
    this.people = db.collection('people');
    this.memories = db.collection('memories');
    await this.memories.createIndex({ personId: 1, createdAt: -1 });
    await this.memories.createIndex({ text: 'text' });
    return this;
  }

  static #strip = { projection: { _id: 0 } };

  async listPeople() {
    return this.people.find({}, MongoStore.#strip).sort({ createdAt: 1 }).toArray();
  }

  async getPerson(id) {
    return this.people.findOne({ id }, MongoStore.#strip);
  }

  async createPerson(input) {
    const p = { id: uid(), ...cleanPerson(input), createdAt: now() };
    await this.people.insertOne({ ...p });
    return p;
  }

  async updatePerson(id, input) {
    const p = await this.getPerson(id);
    if (!p) return null;
    const next = { ...p, ...cleanPerson({ ...p, ...input }) };
    await this.people.updateOne({ id }, { $set: next });
    return next;
  }

  async deletePerson(id) {
    const r = await this.people.deleteOne({ id });
    await this.memories.deleteMany({ personId: id });
    return r.deletedCount > 0;
  }

  async listMemories(personId) {
    return this.memories.find({ personId }, MongoStore.#strip).sort({ createdAt: -1 }).toArray();
  }

  async addMemory(personId, input) {
    const clean = cleanMemory(input);
    if (!clean.text) return null;
    const m = { id: uid(), personId, ...clean, createdAt: now() };
    await this.memories.insertOne({ ...m });
    return m;
  }

  async deleteMemory(personId, id) {
    const r = await this.memories.deleteOne({ id, personId });
    return r.deletedCount > 0;
  }

  async exportAll() {
    return {
      exportedAt: now(),
      people: await this.people.find({}, MongoStore.#strip).toArray(),
      memories: await this.memories.find({}, MongoStore.#strip).toArray(),
    };
  }

  async wipe() {
    await this.people.deleteMany({});
    await this.memories.deleteMany({});
  }

  async close() {
    await this.client?.close();
  }
}

export async function openStore(config) {
  if (config.mongoUri) {
    try {
      return await new MongoStore(config.mongoUri, config.mongoDb).init();
    } catch (err) {
      console.warn(`[store] MongoDB unavailable (${err.message}); falling back to local file store.`);
    }
  }
  return new FileStore(config.dataDir).init();
}
