/**
 * Tiny, dependency-free BM25 retrieval over a family's memories.
 *
 * A single person rarely has more than a few hundred stories, so lexical
 * search is fast, deterministic, and needs no embedding model or vector DB.
 * It is accent-insensitive and understands basic English + Spanish stopwords,
 * because ofrendas are often bilingual.
 */

const STOP = new Set(
  (
    'a an the and or but of to in on at for with from by is are was were be been it its this that these those i you he she we they me my your his her our their ' +
    'do did does what who when where why how about tell remember ' +
    'el la los las un una unos unas y o pero de del al en con por para es son fue eran que se su sus mi tu yo lo le les como cuando donde quien cual me nos'
  ).split(/\s+/),
);

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

/** Very light suffix stripping so "cooking"/"cooked"/"cooks" and "tamales"/"tamal" meet. */
function stem(t) {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

/** Turn a person's profile into pseudo-memories so "favorite song?" is answerable. */
export function profileFacts(person) {
  const facts = [];
  const name = person.name;
  const say = (xs, one, many) => (xs.length === 1 ? `${name}'s favorite ${one} was ${xs[0]}.` : `${name}'s favorite ${many} were ${xs.join(', ')}.`);
  if (person.foods?.length) facts.push({ id: 'fact:foods', text: say(person.foods, 'food', 'foods'), source: 'profile' });
  if (person.songs?.length) facts.push({ id: 'fact:songs', text: say(person.songs, 'song', 'songs'), source: 'profile' });
  // Relation and years are deliberately NOT facts: given as filler, a small model used
  // them to dodge ("born in 1941") instead of admitting it lacks the answer.
  return facts;
}

/**
 * @param {string} query
 * @param {{id:string,text:string,createdAt?:string}[]} docs
 * @param {{k?:number, minRecent?:number}} opts
 * @returns docs ranked by relevance. Pads with the most recent memories so a
 *          vague message ("hi, I miss you") still has something to ground on.
 */
export function retrieve(query, docs, { k = 6, minRecent = 2 } = {}) {
  const q = [...new Set(tokenize(query))];
  const tokenized = docs.map((d) => ({ d, toks: tokenize(d.text) }));
  const N = tokenized.length || 1;
  const avgLen = tokenized.reduce((s, x) => s + x.toks.length, 0) / N || 1;

  const df = new Map();
  for (const { toks } of tokenized) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);

  const k1 = 1.4;
  const b = 0.75;
  const scored = tokenized.map(({ d, toks }) => {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / avgLen));
    }
    return { d, score };
  });

  const hits = scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k)
    .map((s) => s.d);

  if (hits.length >= minRecent) return hits;

  const have = new Set(hits.map((h) => h.id));
  const recent = docs
    .filter((d) => d.source !== 'profile' && !have.has(d.id))
    .sort((a, b2) => (b2.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, minRecent - hits.length);
  return [...hits, ...recent];
}

/**
 * Choose what the model gets to read. A family's stories almost always fit in the
 * context window, so we hand over *everything that fits*, ordered by relevance
 * (profile facts first, then BM25 hits, then the rest newest-first). Retrieval
 * only decides priority when the corpus outgrows the budget, so a question in
 * Spanish about a story written in English is still answerable.
 */
export function selectContext(query, docs, budgetChars = 3600) {
  const facts = docs.filter((d) => d.source === 'profile');
  const memories = docs.filter((d) => d.source !== 'profile');
  const ranked = retrieve(query, memories, { k: memories.length, minRecent: 0 });
  const seen = new Set(ranked.map((d) => d.id));
  const rest = memories.filter((d) => !seen.has(d.id)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const picked = [];
  let used = 0;
  for (const d of [...facts, ...ranked, ...rest]) {
    const cost = d.text.length + 3;
    if (used + cost > budgetChars && picked.length) continue; // skip what doesn't fit, keep trying shorter ones
    picked.push(d);
    used += cost;
  }
  return picked;
}
