/* Ofrenda front end. No frameworks, no CDNs: it works with the Wi-Fi off. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny hyperscript helper. Uses textContent only, so user stories can never inject HTML. */
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

async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body && !raw ? { 'content-type': 'application/json' } : undefined,
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 && path !== '/login') return showLock();
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Request failed (${res.status})`);
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() : res;
}

const state = { features: null, people: [], current: null, memories: [], history: [], speaking: null, lastLetter: '' };

/* ---------- decorations ------------------------------------------------ */
(function papel() {
  const colors = ['#e5338b', '#ff9f1c', '#19c3b1', '#8a4dff', '#ffd23f', '#ff5d8f'];
  const n = Math.ceil(window.innerWidth / 36);
  $('#papel').append(...Array.from({ length: n }, (_, i) => h('i', { style: `--c:${colors[i % colors.length]};--d:${(i % 7) * -0.6}s` })));
})();

function marigolds(count) {
  return h('div', { class: 'marigolds', 'aria-hidden': 'true' }, Array.from({ length: count }, (_, i) =>
    h('span', { class: 'flor', style: `--s:${22 + ((i * 7) % 14)}px;--r:${(i * 37) % 36}deg;--d:${(i % 5) * -0.8}s` })));
}

const candle = (d) => h('div', { class: 'candle', style: `--d:${d}s`, 'aria-hidden': 'true' });

function renderAltar(p) {
  const frame = h('div', { class: 'frame' }, p.photo ? h('img', { src: p.photo, alt: `Photo of ${p.name}` }) : h('span', {}, p.name.trim()[0]?.toUpperCase() || '✦'));
  const foods = p.foods.slice(0, 4).map((f) => h('div', { class: 'offering' }, h('b', {}, '🍽'), f));
  const songs = p.songs.slice(0, 3).map((s) => h('div', { class: 'offering' }, h('b', {}, '♪'), s));
  $('#altar').replaceChildren(
    h('h2', {}, p.name),
    h('div', { class: 'years' }, [p.relation, p.years].filter(Boolean).join(' · ') || '\u00a0'),
    h('div', { class: 'tier t1' }, candle(0), candle(-0.4), frame, candle(-0.9), candle(-0.2)),
    marigolds(18),
    h('div', { class: 'tier t2' }, ...songs, h('div', { class: 'offering' }, h('b', {}, '💧'), 'agua'), h('div', { class: 'offering' }, h('b', {}, '🧂'), 'sal')),
    h('div', { class: 'tier t3' }, ...foods, !foods.length && !songs.length ? h('div', { class: 'offering' }, h('b', {}, '🍞'), 'Add favorite foods & songs to fill the altar') : null),
    marigolds(26),
  );
}

/* ---------- status badges --------------------------------------------- */
function renderBadges() {
  const f = state.features;
  const ms = f.model_status;
  const badges = [];
  if (!ms.reachable) badges.push(h('span', { class: 'badge bad', title: ms.error }, '● model offline: run `ollama serve`'));
  else if (!ms.installed) badges.push(h('span', { class: 'badge bad' }, `● run: ollama pull ${f.model}`));
  else badges.push(h('span', { class: `badge ${f.localModel ? 'ok' : 'warn'}` }, `${f.localModel ? '● local' : '☁ remote'} · ${f.model}`));
  badges.push(h('span', { class: 'badge' }, f.store === 'mongodb' ? '🍃 MongoDB Atlas' : '📁 local file'));
  if (f.voice === 'elevenlabs') badges.push(h('span', { class: 'badge warn', title: 'Narration and transcription use the ElevenLabs cloud API' }, '☁ cloud voice'));
  if (f.tracing) badges.push(h('span', { class: 'badge', title: 'Sentry receives timings and token counts only' }, '📈 tracing'));
  $('#badges').replaceChildren(...badges);
  $('#storeKind').textContent = f.store === 'mongodb' ? 'your MongoDB Atlas cluster' : 'a JSON file on this machine';
  $('#recBtn').hidden = !f.transcribe;
}

/* ---------- boot / lock ------------------------------------------------ */
function showLock() {
  $('#app').hidden = true;
  $('#lock').hidden = false;
  $('#pin').focus();
}

$('#lockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/login', { method: 'POST', body: { pin: $('#pin').value } });
    $('#lock').hidden = true;
    $('#pin').value = '';
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

/* ---------- people ----------------------------------------------------- */
async function loadPeople(selectId) {
  state.people = await api('/people');
  const list = $('#peopleList');
  list.replaceChildren(...state.people.map((p) =>
    h('li', {}, h('button', { 'aria-current': String(p.id === state.current?.id), onclick: () => selectPerson(p.id) },
      p.photo ? h('img', { class: 'avatar', src: p.photo, alt: '' }) : h('span', { class: 'avatar' }, p.name.trim()[0]?.toUpperCase() || '✦'),
      h('span', {}, p.name, h('small', {}, [p.relation, p.years].filter(Boolean).join(' · ')))))));
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
  $('#chat').replaceChildren();
  $('#empty').hidden = true;
  $('#person').hidden = false;
  $$('.pname').forEach((el) => (el.textContent = state.current.name));
  $$('#peopleList button').forEach((b, i) => b.setAttribute('aria-current', String(state.people[i].id === id)));
  renderAltar(state.current);
  hideLetter();
  greet();
  await loadMemories();
}

const dlg = $('#personDlg');
let editingId = null;
let photoData = '';

function openDialog(person) {
  editingId = person?.id ?? null;
  photoData = person?.photo ?? '';
  const f = $('#personForm');
  f.reset();
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
}

$('#addPerson').onclick = $('#addPerson2').onclick = () => openDialog();
$('#dlgCancel').onclick = () => dlg.close();
$('#dlgDelete').onclick = async () => {
  if (!confirm(`Remove ${state.current.name} and all their memories from this altar? This cannot be undone.`)) return;
  await api(`/people/${editingId}`, { method: 'DELETE' });
  dlg.close();
  state.current = null;
  await loadPeople();
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
  if (file) photoData = await shrinkImage(file).catch(() => '');
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
  } catch (err) {
    alert(err.message);
  }
});
$('#altar').addEventListener('dblclick', () => state.current && openDialog(state.current));
$('#altar').title = 'Double-click to edit';

/* ---------- tabs ------------------------------------------------------- */
$$('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('.tab').forEach((t) => (t.hidden = t.id !== `tab-${b.dataset.tab}`));
    if (b.dataset.tab === 'talk') $('#chatInput').focus();
  }));

/* ---------- memories --------------------------------------------------- */
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const SOURCE_LABEL = { typed: '✍ written', voice: '🎙 spoken', ghost: '🕯 from a letter' };

async function loadMemories() {
  state.memories = await api(`/people/${state.current.id}/memories`);
  $('#memList').replaceChildren(...state.memories.map((m) =>
    h('li', { 'data-id': m.id }, h('p', {}, m.text),
      h('div', { class: 'meta' }, h('span', {}, `${SOURCE_LABEL[m.source] || ''} · ${fmtDate(m.createdAt)}`),
        h('button', { class: 'del', title: 'Delete this memory', onclick: () => delMemory(m.id) }, 'Delete')))));
  if (!state.memories.length) $('#memList').append(h('li', {}, h('p', { class: 'muted' }, 'No stories yet. Tell the first one above 🌼')));
}

let memSource = 'typed';
$('#memForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#memText').value.trim();
  if (!text) return;
  await api(`/people/${state.current.id}/memories`, { method: 'POST', body: { text, source: memSource } });
  $('#memText').value = '';
  memSource = 'typed';
  await loadMemories();
});
async function delMemory(id) {
  if (!confirm('Delete this memory? The ghost will forget it.')) return;
  await api(`/people/${state.current.id}/memories/${id}`, { method: 'DELETE' });
  await loadMemories();
}

/* oral history recording (needs ElevenLabs key; transcript is editable before saving) */
let recorder = null;
$('#recBtn').addEventListener('click', async () => {
  const status = $('#recStatus');
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
      $('#recBtn').textContent = '🎙 Record a story';
      status.textContent = 'Transcribing (audio is sent to ElevenLabs)…';
      try {
        const { text } = await api('/transcribe', { method: 'POST', raw: new Blob(chunks, { type }) });
        $('#memText').value = [$('#memText').value, text].filter(Boolean).join('\n');
        memSource = 'voice';
        status.textContent = 'Transcribed. Edit anything, then keep the memory.';
      } catch (err) {
        status.textContent = err.message;
      }
    };
    recorder.start();
    $('#recBtn').textContent = '⏹ Stop recording';
    status.textContent = 'Listening… tell the story.';
  } catch {
    status.textContent = 'Microphone unavailable.';
  }
});

/* ---------- streaming helper ------------------------------------------ */
async function streamSSE(path, body, signal, onEvent) {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (res.status === 401) return showLock();
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

/* ---------- talk ------------------------------------------------------- */
function greet() {
  const p = state.current;
  addMsg('ghost', `I'm only an echo of what's been written about ${p.name}. Ask me about a story, a song, a recipe. If I don't know, I'll tell you, and you can teach me.`);
}

function addMsg(role, text, extra) {
  const el = h('div', { class: `msg ${role}` }, h('span', { class: 'body' }, text));
  if (extra) el.append(extra);
  $('#chat').append(el);
  $('#chat').scrollTop = $('#chat').scrollHeight;
  return el;
}

let chatAbort = null;
$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  const message = input.value.trim();
  if (!message || chatAbort) return;
  input.value = '';
  addMsg('user', message);
  const el = addMsg('ghost', '');
  el.classList.add('typing');
  const body = el.querySelector('.body');
  let reply = '';
  let sources = { ids: [], facts: 0 };
  chatAbort = new AbortController();
  $('#sendBtn').disabled = true;
  $('#stopBtn').hidden = false;
  try {
    await streamSSE(`/people/${state.current.id}/chat`, { message, history: state.history, mode: $('#mode').value }, chatAbort.signal, (ev) => {
      if (ev.type === 'sources') sources = ev;
      if (ev.type === 'token') { reply += ev.text; body.textContent = reply; $('#chat').scrollTop = $('#chat').scrollHeight; }
      if (ev.type === 'error') { el.classList.add('error'); body.textContent = ev.message; }
      if (ev.type === 'done' && !ev.stats.aborted) el.append(metaRow(reply, ev.stats, sources));
    });
    if (reply) state.history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
  } catch (err) {
    if (err.name !== 'AbortError') { el.classList.add('error'); body.textContent = err.message; }
  } finally {
    el.classList.remove('typing');
    chatAbort = null;
    $('#sendBtn').disabled = false;
    $('#stopBtn').hidden = true;
    input.focus();
  }
});
$('#stopBtn').onclick = () => chatAbort?.abort();
$('#clearChat').onclick = () => { state.history = []; $('#chat').replaceChildren(); greet(); };

function metaRow(text, stats, sources) {
  const row = h('div', { class: 'meta' });
  if (stats.firstTokenMs != null) row.append(h('span', { title: 'Time to first word / generation speed, measured on your machine' }, `${(stats.firstTokenMs / 1000).toFixed(1)}s to first word · ${stats.estimated ? '~' : ''}${stats.tokensPerSec} tok/s`));
  const n = sources.ids.length;
  const parts = [n && `${n} memor${n === 1 ? 'y' : 'ies'}`, sources.facts && 'the profile'].filter(Boolean);
  row.append(h('span', {}, parts.length ? `read ${parts.join(' + ')}` : 'nothing written yet'));
  row.append(h('button', { onclick: () => speakText(text) }, '🔊 listen'));
  return row;
}

/* ---------- speech ----------------------------------------------------- */
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
    } catch { /* fall through to local speech */ }
  }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.92;
  speechSynthesis.speak(u);
}

/* ---------- letter ----------------------------------------------------- */
function hideLetter() { $('#letterOut').hidden = true; $('#letterActions').hidden = true; state.lastLetter = ''; }

$('#writeBtn').addEventListener('click', async () => {
  const out = $('#letterOut');
  out.hidden = false;
  out.textContent = '';
  $('#letterActions').hidden = true;
  $('#writeBtn').disabled = true;
  let text = '';
  try {
    await streamSSE(`/people/${state.current.id}/remembrance`, { style: $('#style').value, lang: $('#lang').value }, undefined, (ev) => {
      if (ev.type === 'token') { text += ev.text; out.textContent = text; }
      if (ev.type === 'error') out.textContent = ev.message;
    });
    state.lastLetter = text.trim();
    $('#letterActions').hidden = !state.lastLetter;
  } catch (err) {
    out.textContent = err.message;
  } finally {
    $('#writeBtn').disabled = false;
  }
});
$('#speakLetter').onclick = () => speakText(state.lastLetter);
$('#copyLetter').onclick = () => navigator.clipboard.writeText(state.lastLetter);
$('#keepLetter').onclick = async () => {
  await api(`/people/${state.current.id}/memories`, { method: 'POST', body: { text: state.lastLetter, source: 'ghost' } });
  await loadMemories();
  $('#keepLetter').textContent = 'Kept ✓';
};

/* ---------- data controls --------------------------------------------- */
$('#exportBtn').onclick = () => { location.href = '/api/export'; };
$('#wipeBtn').onclick = async () => {
  if (prompt('This erases every person and memory. Type DELETE to confirm.') !== 'DELETE') return;
  await api('/data', { method: 'DELETE', body: { confirm: 'DELETE' } });
  state.current = null;
  await loadPeople();
};

async function refreshStats() {
  const s = await api('/stats').catch(() => null);
  if (!s) return;
  $('#statsBox').textContent = s.runs
    ? `Last ${s.runs} replies: ${(s.avgFirstTokenMs / 1000).toFixed(1)}s to first word, ${s.avgTokensPerSec} tok/s`
    : 'No replies yet this session.';
}
setInterval(() => state.features && refreshStats(), 15000);

boot();
