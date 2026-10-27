/* Ofrenda front end. No frameworks, no CDNs: it works with the Wi-Fi off. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const NS = 'http://www.w3.org/2000/svg';

/** Tiny hyperscript helper. Uses text nodes only, so user stories can never inject HTML. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

/** <svg><use href="#i-name"/></svg> from the sprite in index.html */
function ic(name, cls = 'ic') {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', cls);
  const u = document.createElementNS(NS, 'use');
  u.setAttribute('href', `#i-${name}`);
  s.append(u);
  return s;
}

const state = { features: null, people: [], current: null, memories: [], history: [], mode: 'echo', lastLetter: '' };
const COLORS = ['#f0467f', '#ff9f1c', '#2dd4bf', '#8b5cf6', '#ffd23f', '#ff6f91'];

/* ---------- feedback: toasts + dialogs (no window.alert/confirm/prompt) ---- */
function toast(msg, kind = 'ok') {
  const t = h('div', { class: `toast ${kind}` }, ic(kind === 'ok' ? 'check' : 'x'), msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}
const fail = (err) => err?.message !== 'locked' && toast(err?.message || 'Something went wrong', 'bad');

function confirmDialog({ title, body = '', ok = 'Confirm', danger = false, type = '' }) {
  return new Promise((resolve) => {
    const d = $('#confirmDlg');
    $('#cTitle').textContent = title;
    $('#cBody').textContent = body;
    $('#cOk').textContent = ok;
    $('#cOk').className = `btn primary${danger ? ' dng' : ''}`;
    $('#cTypeWrap').hidden = !type;
    $('#cTypeWord').textContent = type;
    $('#cType').value = '';
    const finish = (v) => { d.close(); resolve(v); };
    $('#confirmForm').onsubmit = (e) => {
      e.preventDefault();
      if (type && $('#cType').value.trim() !== type) return $('#cType').focus();
      finish(true);
    };
    $('#cCancel').onclick = () => finish(false);
    d.addEventListener('cancel', () => resolve(false), { once: true });
    d.showModal();
    (type ? $('#cType') : $('#cOk')).focus();
  });
}

/* ---------- API --------------------------------------------------------- */
async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body && !raw ? { 'content-type': 'application/json' } : undefined,
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 && path !== '/login') {
    showLock();
    throw new Error('locked');
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Request failed (${res.status})`);
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() : res;
}

async function streamSSE(path, body, signal, onEvent) {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (res.status === 401) { showLock(); throw new Error('locked'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (line.startsWith('data:')) onEvent(JSON.parse(line.slice(5)));
    }
  }
}

/* ---------- decoration -------------------------------------------------- */
(function buildFlor() {
  const sym = $('#flor');
  const ring = (n, cy, rx, ry, rot, fill) => {
    for (let i = 0; i < n; i++) {
      const e = document.createElementNS(NS, 'ellipse');
      e.setAttribute('cx', 0); e.setAttribute('cy', cy); e.setAttribute('rx', rx); e.setAttribute('ry', ry);
      e.setAttribute('fill', fill);
      e.setAttribute('transform', `rotate(${(i * 360) / n + rot})`);
      sym.append(e);
    }
  };
  ring(14, -30, 10, 20, 0, 'url(#gPetalA)');
  ring(12, -21, 9, 16, 15, 'url(#gPetalB)');
  ring(9, -11, 7, 11, 5, 'url(#gPetalA)');
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('r', 8); c.setAttribute('fill', 'url(#gHeart)');
  sym.append(c);

  // a few drifting petals, purely ambient
  $('#petals').append(...Array.from({ length: 10 }, (_, i) =>
    h('span', { class: 'petal', style: `left:${(i * 73) % 100}%;--s:${8 + ((i * 5) % 9)}px;--t:${16 + ((i * 7) % 14)}s;--d:${-(i * 2.3)}s;--x:${((i % 2) * 2 - 1) * (40 + ((i * 13) % 80))}px` })));
})();

function garland(n) {
  return h('div', { class: 'garland', 'aria-hidden': 'true' }, Array.from({ length: n }, (_, i) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('style', `--s:${30 + ((i * 7) % 16)}px;--r:${(i * 41) % 360}deg;--d:${-(i % 6)}s`);
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#flor');
    s.append(u);
    return s;
  }));
}

const initial = (p) => p.name.trim()[0]?.toUpperCase() || '✦';
const avatar = (p, cls = 'avatar') => p.photo ? h('img', { class: cls, src: p.photo, alt: '' }) : h('span', { class: cls, 'aria-hidden': 'true' }, initial(p));
const offer = (icon, text) => h('span', { class: 'offer' }, ic(icon), text);

function renderAltar(p) {
  const candles = (cls, start) => h('div', { class: `candles ${cls}`, 'aria-hidden': 'true' },
    [0, 1].map((i) => h('div', { class: 'candle', style: `--d:${-(i + start) * 0.37}s` })));
  const songs = p.songs.slice(0, 4).map((s) => offer('music', s));
  const foods = p.foods.slice(0, 5).map((f) => offer('food', f));

  $('#altar').replaceChildren(
    h('div', { class: 'papel', 'aria-hidden': 'true' }, Array.from({ length: 18 }, (_, i) => h('i', { style: `--c:${COLORS[i % 6]};--d:${(i % 7) * -0.6}s` }))),
    h('div', { class: 'altar-head' },
      h('h2', {}, p.name),
      h('p', {}, [p.relation, p.years].filter(Boolean).join(' · ') || '\u00a0'),
      h('button', { class: 'icon-btn altar-edit', title: `Edit ${p.name}`, 'aria-label': `Edit ${p.name}`, onclick: () => openDialog(p) }, ic('pencil'))),
    h('div', { class: 'niche' },
      candles('l', 0),
      h('div', { class: 'arch' }, h('div', { class: 'arch-in' }, p.photo ? h('img', { src: p.photo, alt: `Photo of ${p.name}` }) : h('span', {}, initial(p)))),
      candles('r', 2)),
    garland(20),
    h('div', { class: 'steps' },
      h('div', { class: 'step s1' }, ...(songs.length ? songs : [h('span', { class: 'offer hint' }, 'Edit to add favorite songs')])),
      h('div', { class: 'step s2' }, ...foods, offer('drop', 'agua'), !foods.length ? h('span', { class: 'offer hint' }, 'and favorite foods') : null),
      h('div', { class: 'step s3' }, garland(30))),
  );
}

/* ---------- header: badges + data menu ---------------------------------- */
function renderBadges() {
  const f = state.features;
  const ms = f.model_status;
  const chips = [];
  if (!ms.reachable) chips.push(h('span', { class: 'chip bad', title: ms.error }, f.localModel ? 'Model offline · run ollama serve' : 'Model host unreachable'));
  else if (!ms.installed) chips.push(h('span', { class: 'chip bad', title: f.localModel ? '' : 'The model is still downloading, or OFRENDA_MODEL differs between services' }, f.localModel ? `Run: ollama pull ${f.model}` : `Model ${f.model} not on host yet`));
  else chips.push(h('span', { class: `chip ${f.localModel ? 'ok' : 'warn'}`, title: f.localModel ? 'Nothing leaves this machine' : 'The model runs on a remote host' }, `${f.localModel ? 'Local' : 'Remote'} · ${f.model}`));
  chips.push(h('span', { class: 'chip', title: 'Where your altar is stored' }, f.store === 'mongodb' ? 'MongoDB Atlas' : f.localModel ? 'Local file' : 'Server file'));
  if (f.voice === 'elevenlabs') chips.push(h('span', { class: 'chip warn', title: 'Narration and transcription use the ElevenLabs cloud API' }, 'Cloud voice'));
  if (f.tracing) chips.push(h('span', { class: 'chip', title: 'Sentry receives timings and token counts only' }, 'Tracing'));
  $('#badges').replaceChildren(...chips);
  $('#storeKind').textContent = f.store === 'mongodb' ? 'your MongoDB Atlas cluster' : f.localModel ? 'a JSON file on this machine' : 'a JSON file on the server';
  // Be truthful when this is a hosted deployment rather than a laptop.
  $('#whereModel').textContent = f.localModel ? 'your own computer' : 'a server you host';
  $('#promiseStay').textContent = f.localModel
    ? (f.store === 'mongodb' ? 'Your stories live in your own Atlas cluster.' : 'Your stories stay on this machine.')
    : `Your stories live on the server you deployed${f.pinRequired ? ', behind your PIN' : ''}.`;
  $('#promiseOffline').hidden = !f.localModel;
  $('#recBtn').hidden = !f.transcribe;
  $('#menu').hidden = false;
}

document.addEventListener('click', (e) => { const m = $('#menu'); if (m.open && !m.contains(e.target)) m.open = false; });
$('#exportBtn').onclick = () => { location.href = '/api/export'; };
$('#wipeBtn').onclick = async () => {
  $('#menu').open = false;
  const ok = await confirmDialog({ title: 'Erase everything?', body: 'Every person and every memory will be permanently deleted from this altar.', ok: 'Erase everything', danger: true, type: 'DELETE' });
  if (!ok) return;
  try { await api('/data', { method: 'DELETE', body: { confirm: 'DELETE' } }); state.current = null; await loadPeople(); toast('Everything erased'); } catch (e) { fail(e); }
};

async function refreshStats() {
  const s = await api('/stats').catch(() => null);
  if (!s) return;
  $('#statsBox').textContent = s.runs ? `Last ${s.runs} replies: ${(s.avgFirstTokenMs / 1000).toFixed(1)}s to first word` : 'No replies yet this session.';
}
setInterval(() => state.features && refreshStats(), 15000);

/* ---------- boot / lock ------------------------------------------------- */
function showLock() {
  $('#app').hidden = true;
  $('#menu').hidden = true;
  $('#lock').hidden = false;
  $('#pin').focus();
}

$('#lockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/login', { method: 'POST', body: { pin: $('#pin').value } });
    $('#lock').hidden = true;
    $('#pin').value = '';
    $('#lockErr').textContent = '';
    boot();
  } catch (err) {
    $('#lockErr').textContent = err.message;
  }
});

async function boot() {
  const f = await fetch('/api/features').then((r) => r.json());
  if (f.pinRequired && !f.authed) return showLock();
  state.features = f;
  $('#lock').hidden = true;
  $('#app').hidden = false;
  renderBadges();
  await loadPeople();
  refreshStats();
}

/* ---------- people ------------------------------------------------------ */
async function loadPeople(selectId) {
  state.people = await api('/people');
  $('#peopleList').replaceChildren(...state.people.map((p) =>
    h('li', {}, h('button', { class: 'person-btn', 'data-id': p.id, 'aria-current': String(p.id === state.current?.id), onclick: () => selectPerson(p.id) },
      avatar(p),
      h('span', {}, h('b', {}, p.name), h('small', {}, [p.relation, p.years].filter(Boolean).join(' · ') || '\u00a0'))))));
  const target = selectId || state.current?.id || state.people[0]?.id;
  if (target && state.people.some((p) => p.id === target)) await selectPerson(target);
  else {
    state.current = null;
    $('#person').hidden = true;
    $('#empty').hidden = false;
  }
}

async function selectPerson(id) {
  state.current = state.people.find((p) => p.id === id);
  state.history = [];
  $('#empty').hidden = true;
  $('#person').hidden = false;
  $$('.pname').forEach((el) => (el.textContent = state.current.name));
  $$('.person-btn').forEach((b) => b.setAttribute('aria-current', String(b.dataset.id === id)));
  renderAltar(state.current);
  hideLetter();
  resetChat();
  await loadMemories();
}

/* add / edit dialog */
const dlg = $('#personDlg');
let editingId = null;
let photoData = '';

function setPhotoPreview(src) {
  $('#photoPreview').hidden = !src;
  $('#photoHint').hidden = Boolean(src);
  if (src) $('#photoPreview').src = src;
}

function openDialog(person) {
  editingId = person?.id ?? null;
  photoData = person?.photo ?? '';
  const f = $('#personForm');
  f.reset();
  setPhotoPreview(photoData);
  $('#dlgTitle').textContent = person ? `Edit ${person.name}` : 'Light a candle';
  $('#dlgDelete').hidden = !person;
  if (person) {
    f.name.value = person.name;
    f.relation.value = person.relation;
    f.years.value = person.years;
    f.foods.value = person.foods.join(', ');
    f.songs.value = person.songs.join(', ');
  }
  dlg.showModal();
  f.name.focus();
}

$('#addPerson').onclick = $('#addPerson2').onclick = () => openDialog();
$('#dlgCancel').onclick = $('#dlgClose').onclick = () => dlg.close();
$('#photoBtn').onclick = () => $('#photoIn').click();
$('#dlgDelete').onclick = async () => {
  const name = state.current?.name || 'this person';
  dlg.close();
  const ok = await confirmDialog({ title: `Remove ${name}?`, body: 'Their altar and every memory you wrote about them will be permanently deleted.', ok: 'Remove', danger: true });
  if (!ok) return;
  try { await api(`/people/${editingId}`, { method: 'DELETE' }); state.current = null; await loadPeople(); toast(`${name} removed`); } catch (e) { fail(e); }
};

/** Downscale to <=640px JPEG so photos stay small and local. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 640 / Math.max(img.width, img.height));
      const c = h('canvas', { width: Math.round(img.width * s), height: Math.round(img.height * s) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
$('#photoIn').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  photoData = await shrinkImage(file).catch(() => '');
  setPhotoPreview(photoData);
};

$('#personForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { name: f.name.value, relation: f.relation.value, years: f.years.value, foods: f.foods.value, songs: f.songs.value, photo: photoData };
  try {
    const saved = editingId ? await api(`/people/${editingId}`, { method: 'PUT', body }) : await api('/people', { method: 'POST', body });
    dlg.close();
    state.current = null;
    await loadPeople(saved.id);
    toast(editingId ? 'Saved' : `A candle is lit for ${saved.name}`);
  } catch (err) {
    fail(err);
  }
});

/** One click to see the app working: a made-up grandmother and three short stories. */
$('#sampleBtn').onclick = async () => {
  $('#sampleBtn').disabled = true;
  try {
    const p = await api('/people', { method: 'POST', body: { name: 'Abuela Rosa', relation: 'grandmother', years: '1941 – 2019', foods: 'tamales, atole, pan dulce', songs: 'Cielito Lindo' } });
    for (const text of [
      'She made tamales every December and sang boleros while the masa rested.',
      'Every Sunday she walked me to Mass and bought pan dulce at the corner bakery.',
      'Her garden was full of marigolds; she called them her little suns.',
    ]) await api(`/people/${p.id}/memories`, { method: 'POST', body: { text } });
    await loadPeople(p.id);
    toast('Sample altar created. Try the Talk tab.');
  } catch (e) { fail(e); } finally { $('#sampleBtn').disabled = false; }
};

/* ---------- tabs -------------------------------------------------------- */
function activateTab(name, focus = false) {
  $$('.tabs [role=tab]').forEach((b) => {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  $$('.panel').forEach((p) => (p.hidden = p.id !== `tab-${name}`));
  if (name === 'talk') $('#chatInput').focus({ preventScroll: true });
}
$$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => activateTab(b.dataset.tab)));
$('.tabs').addEventListener('keydown', (e) => {
  const tabs = $$('.tabs [role=tab]');
  const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next == null) return;
  e.preventDefault();
  activateTab(tabs[(next + tabs.length) % tabs.length].dataset.tab, true);
});

/* segmented controls (radio semantics) */
function seg(root, onChange) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('button', root).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    onChange?.(b.dataset.v ?? b.dataset.mode);
  });
  return () => $('button[aria-checked="true"]', root).dataset.v;
}

/* ---------- memories ---------------------------------------------------- */
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const SOURCE = { typed: ['pencil', 'Written'], voice: ['mic', 'Spoken'], ghost: ['sparkles', 'From a letter'] };

async function loadMemories() {
  state.memories = await api(`/people/${state.current.id}/memories`);
  const list = $('#memList');
  list.replaceChildren(...state.memories.map((m) => {
    const [icon, label] = SOURCE[m.source] || SOURCE.typed;
    return h('li', { class: 'mem' },
      h('p', {}, m.text),
      h('footer', {}, ic(icon, 'ic'), `${label} · ${fmtDate(m.createdAt)}`,
        h('button', { class: 'icon-btn', title: 'Delete this memory', 'aria-label': 'Delete this memory', onclick: () => delMemory(m.id) }, ic('trash'))));
  }));
  if (!state.memories.length) list.append(h('li', { class: 'empty-card' }, `No stories yet. Tell the first one about ${state.current.name} above.`));
}

const memText = $('#memText');
const autosize = () => { memText.style.height = 'auto'; memText.style.height = `${Math.min(memText.scrollHeight, 320)}px`; $('#memCount').textContent = memText.value.length; };
memText.addEventListener('input', autosize);
memText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#memForm').requestSubmit(); });

let memSource = 'typed';
$('#memForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = memText.value.trim();
  if (!text) return;
  try {
    await api(`/people/${state.current.id}/memories`, { method: 'POST', body: { text, source: memSource } });
    memText.value = '';
    autosize();
    memSource = 'typed';
    $('#recStatus').textContent = '';
    await loadMemories();
    toast('Memory kept');
  } catch (err) { fail(err); }
});

async function delMemory(id) {
  const ok = await confirmDialog({ title: 'Delete this memory?', body: 'The ghost will forget it.', ok: 'Delete', danger: true });
  if (!ok) return;
  try { await api(`/people/${state.current.id}/memories/${id}`, { method: 'DELETE' }); await loadMemories(); } catch (e) { fail(e); }
}

/* oral-history recording (needs an ElevenLabs key; the transcript is editable before saving) */
let recorder = null;
$('#recBtn').addEventListener('click', async () => {
  const status = $('#recStatus');
  const label = $('#recBtn span');
  if (recorder) return recorder.stop();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = recorder.mimeType || 'audio/webm';
      recorder = null;
      label.textContent = 'Record a story';
      status.textContent = 'Transcribing (audio goes to ElevenLabs)…';
      try {
        const { text } = await api('/transcribe', { method: 'POST', raw: new Blob(chunks, { type }) });
        memText.value = [memText.value, text].filter(Boolean).join('\n');
        autosize();
        memSource = 'voice';
        status.textContent = 'Transcribed. Edit anything, then keep the memory.';
      } catch (err) { status.textContent = ''; fail(err); }
    };
    recorder.start();
    label.textContent = 'Stop recording';
    status.textContent = 'Listening… tell the story.';
  } catch {
    status.textContent = '';
    toast('Microphone unavailable', 'bad');
  }
});

/* ---------- talk -------------------------------------------------------- */
seg($('.chat-tools .seg'), (m) => { state.mode = m; });
const chatEl = $('#chat');
const scrollChat = () => { chatEl.scrollTop = chatEl.scrollHeight; };

function addMsg(role, content) {
  const bubble = h('div', { class: 'bubble' }, content);
  const wrap = h('div', { class: 'bubble-wrap' }, bubble);
  const el = h('div', { class: `msg ${role}` }, role === 'ghost' ? h('span', { class: 'orb', 'aria-hidden': 'true' }) : null, wrap);
  chatEl.append(el);
  scrollChat();
  return { el, bubble, wrap };
}

const thinking = (text) => h('span', { class: 'thinking' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), text);

function resetChat() {
  state.history = [];
  chatEl.replaceChildren();
  const p = state.current;
  addMsg('ghost', `I'm only an echo of what's been written about ${p.name}. Ask me about a story, a song, a recipe. If I don't know, I'll tell you, and you can teach me.`);
  const chips = [];
  if (p.songs.length) chips.push('What was your favorite song?');
  if (p.foods.length) chips.push(`Tell me about ${p.foods[0]}`);
  chips.push('Tell me a story', 'What did you love to do?', 'Where were you born?');
  $('#suggest').replaceChildren(...chips.map((q) => h('button', { type: 'button', onclick: () => { $('#chatInput').value = q; $('#chatForm').requestSubmit(); } }, q)));
}

let chatAbort = null;
$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  const message = input.value.trim();
  if (!message || chatAbort) return;
  input.value = '';
  $('#suggest').hidden = true;
  addMsg('user', message);
  const g = addMsg('ghost', thinking('Remembering…'));
  let reply = '';
  let sources = { ids: [], facts: 0 };
  chatAbort = new AbortController();
  $('#sendBtn').hidden = true;
  $('#stopBtn').hidden = false;
  try {
    await streamSSE(`/people/${state.current.id}/chat`, { message, history: state.history, mode: state.mode }, chatAbort.signal, (ev) => {
      if (ev.type === 'sources') {
        sources = ev;
        const n = ev.ids.length;
        g.bubble.replaceChildren(thinking(n ? `Reading ${n} memor${n === 1 ? 'y' : 'ies'}…` : 'Remembering…'));
      }
      if (ev.type === 'token') { reply += ev.text; g.bubble.textContent = reply.trimStart(); scrollChat(); }
      if (ev.type === 'error') { g.el.classList.add('error'); g.bubble.textContent = ev.message; }
      if (ev.type === 'done' && !ev.stats.aborted && reply) g.wrap.append(metaRow(reply, ev.stats, sources));
    });
    if (reply) state.history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
    else if (!g.el.classList.contains('error') && g.bubble.querySelector('.thinking')) g.el.remove();
  } catch (err) {
    if (err.name === 'AbortError') { if (!reply) g.el.remove(); }
    else { g.el.classList.add('error'); g.bubble.textContent = err.message; }
  } finally {
    chatAbort = null;
    $('#sendBtn').hidden = false;
    $('#stopBtn').hidden = true;
    input.focus();
    scrollChat();
  }
});
$('#stopBtn').onclick = () => chatAbort?.abort();
$('#clearChat').onclick = () => { chatAbort?.abort(); resetChat(); };

function metaRow(text, stats, sources) {
  const row = h('div', { class: 'meta' });
  if (stats.firstTokenMs != null) {
    // Speed is only meaningful for a real generation, not a 5-token "EVIDENCE: NONE".
    const speed = stats.gate !== 'refuse' && stats.outputTokens >= 15 ? ` · ${stats.estimated ? '~' : ''}${stats.tokensPerSec} tok/s` : '';
    const check = stats.verifyMs ? `, of which ${(stats.verifyMs / 1000).toFixed(1)}s checking the memory fits` : '';
    row.append(h('span', { class: 'tag', title: `Measured on your machine${check}. Token counts are estimates.` }, `${(stats.firstTokenMs / 1000).toFixed(1)}s${speed}`));
  }
  const n = sources.ids.length;
  const parts = [n && `${n} memor${n === 1 ? 'y' : 'ies'}`, sources.facts && 'profile'].filter(Boolean);
  row.append(h('span', { class: 'tag' }, parts.length ? `Read ${parts.join(' + ')}` : 'Nothing written yet'));
  row.append(h('button', { type: 'button', onclick: () => speakText(text) }, ic('volume'), 'Listen'));
  return row;
}

/* ---------- speech ------------------------------------------------------ */
let currentAudio = null;
async function speakText(text) {
  currentAudio?.pause();
  speechSynthesis.cancel();
  if (state.features.voice === 'elevenlabs') {
    try {
      const res = await api('/speak', { method: 'POST', body: { text } });
      const url = URL.createObjectURL(await res.blob());
      currentAudio = new Audio(url);
      currentAudio.onended = () => URL.revokeObjectURL(url);
      return currentAudio.play();
    } catch { /* fall through to on-device speech */ }
  }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.92;
  speechSynthesis.speak(u);
}

/* ---------- letter ------------------------------------------------------ */
const getStyle = seg($('#styleSeg'));
const getLang = seg($('#langSeg'));

function hideLetter() {
  $('#letterOut').hidden = true;
  $('#letterActions').hidden = true;
  $('#keepLetter').replaceChildren(ic('check'), 'Keep as a memory');
  state.lastLetter = '';
}

$('#writeBtn').addEventListener('click', async () => {
  const out = $('#letterOut');
  hideLetter();
  out.hidden = false;
  out.className = 'paper loading';
  out.textContent = 'Lighting a candle…';
  $('#writeBtn').disabled = true;
  let text = '';
  try {
    await streamSSE(`/people/${state.current.id}/remembrance`, { style: getStyle(), lang: getLang() }, undefined, (ev) => {
      if (ev.type === 'token') { out.classList.remove('loading'); text += ev.text; out.textContent = text; }
      if (ev.type === 'error') { out.classList.remove('loading'); out.textContent = ev.message; }
    });
    state.lastLetter = text.trim();
    $('#letterActions').hidden = !state.lastLetter;
  } catch (err) {
    out.hidden = true;
    fail(err);
  } finally {
    $('#writeBtn').disabled = false;
  }
});
$('#speakLetter').onclick = () => speakText(state.lastLetter);
$('#printLetter').onclick = () => window.print();
$('#copyLetter').onclick = async () => { await navigator.clipboard.writeText(state.lastLetter).catch(() => {}); toast('Copied'); };
$('#keepLetter').onclick = async () => {
  try {
    await api(`/people/${state.current.id}/memories`, { method: 'POST', body: { text: state.lastLetter, source: 'ghost' } });
    await loadMemories();
    $('#keepLetter').replaceChildren(ic('check'), 'Kept');
    toast('Kept as a memory');
  } catch (e) { fail(e); }
};

boot();
