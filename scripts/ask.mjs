#!/usr/bin/env node
// Dev helper: talk to a running Ofrenda server from the terminal.
//   node scripts/ask.mjs "What did she cook?" [--mode keeper] [--person "Abuela Rosa"] [--port 3000]
const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : d);
const message = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const base = `http://127.0.0.1:${flag('port', 3000)}`;
if (!message) throw new Error('usage: ask.mjs "message" [--mode echo|keeper] [--person name] [--port N]');

const people = await (await fetch(`${base}/api/people`)).json();
const want = flag('person');
const person = want ? people.find((p) => p.name.toLowerCase().includes(want.toLowerCase())) : people[0];
if (!person) throw new Error('no such person');

const res = await fetch(`${base}/api/people/${person.id}/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message, mode: flag('mode', 'echo') }),
});
const dec = new TextDecoder();
let buf = '';
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 2);
    if (!line.startsWith('data:')) continue;
    const e = JSON.parse(line.slice(5));
    if (e.type === 'token') process.stdout.write(e.text);
    else if (e.type === 'sources') process.stdout.write(`[grounded in ${e.ids.length} memories]\n`);
    else console.log(`\n${JSON.stringify(e)}`);
  }
}
