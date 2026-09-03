// Headless end-to-end check of layers 1–2 (parser → tools) against the demo
// visa form. This covers everything that does NOT depend on the Chrome WebMCP
// flag: field extraction, confidence, translate flags, constraint validation,
// the stable error enum + Thai strings, and the filled/failed/needs_human split.
//
// Run: npx tsx test/tools.test.ts   (or: npm test)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '../demo/visa-form.html'), 'utf8');

const dom = new JSDOM(html, { url: 'https://example.gov/visa' });
const { window } = dom;

// Wire the globals the content-script modules expect, before importing them.
// The real API is document.modelContext with an async registerTool and no
// unregisterTool (Chrome 149+); mirror that here.
const tools: Record<string, any> = {};
Object.defineProperty(window.document, 'modelContext', {
  configurable: true,
  value: {
    registerTool: async (t: any) => {
      if (tools[t.name]) throw new Error('Duplicate tool name');
      tools[t.name] = t;
    },
    getTools: async () => Object.values(tools),
    executeTool: async (t: any, args: string) => t.execute(JSON.parse(args || '{}')),
  },
});

const g = globalThis as any;
g.window = window;
g.document = window.document;
// Node 21+ exposes a getter-only global `navigator`; override via defineProperty.
Object.defineProperty(g, 'navigator', { configurable: true, value: window.navigator });
g.location = window.location;
g.CSS = window.CSS;
g.Event = window.Event;
g.CustomEvent = window.CustomEvent;
g.HTMLElement = window.HTMLElement;
g.HTMLInputElement = window.HTMLInputElement;
g.HTMLSelectElement = window.HTMLSelectElement;
g.HTMLFormElement = window.HTMLFormElement;
g.MutationObserver = window.MutationObserver;

// ---- tiny assert harness --------------------------------------------------
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const { syncTools } = await import('../src/tools/register.ts');
  syncTools();
  // registerTool is async now — let the registration microtasks flush.
  await new Promise((r) => setTimeout(r, 0));

  console.log('\ndescribe_form:');
  check('four tools registered', Object.keys(tools).length === 4, Object.keys(tools).join(','));
  check('describe_form present', !!tools.describe_form);
  check('read_form present', !!tools.read_form);
  check('fill_form present', !!tools.fill_form);
  check('submit_form present', !!tools.submit_form);

  const described = JSON.parse((await tools.describe_form.execute()).content[0].text);
  const byId: Record<string, any> = Object.fromEntries(described.fields.map((f: any) => [f.id, f]));

  check('all 11 fillable fields parsed', described.fields.length === 11, String(described.fields.length));
  check('email preserved (not translated)', byId.email.translate === false);
  check('passport preserved (has pattern)', byId.passport_no.translate === false);
  check('purpose translated (free text)', byId.purpose.translate === true);
  check('given_name preserved (autocomplete name)', byId.given_name.translate === false);
  check('nationality has 4 real options', byId.nationality.constraints.options.length === 4);
  check('stay_days min/max captured', byId.stay_days.constraints.min === 1 && byId.stay_days.constraints.max === 90);
  check('email high confidence (label-for)', byId.email.confidence === 'high');
  check('unlabeled field is low confidence', byId.mystery.confidence === 'low', byId.mystery.confidence);
  check('required flags read', byId.email.required === true && byId.phone.required === false);

  console.log('\nfill_form (mixed valid / failed / needs_human):');
  const res = JSON.parse(
    (
      await tools.fill_form.execute({
        values: {
          given_name: 'Somchai',
          family_name: 'Jaidee',
          email: 'somchai@example.com',
          passport_no: 'AA123456',
          national_id: '123456789012', // 12 digits — pattern wants 13
          nationality: 'Thailand', // matches option label, not value
          stay_days: '200', // out of range (max 90)
          purpose: 'Tourism',
          mystery: 'anything', // low confidence → needs_human, never filled
        },
      })
    ).content[0].text
  );

  check('valid fields filled', ['given_name', 'family_name', 'email', 'passport_no', 'purpose'].every((f) => res.filled.includes(f)), res.filled.join(','));
  check('nationality accepted by label', res.filled.includes('nationality'));
  check('national_id → pattern_mismatch', res.failed.some((e: any) => e.field === 'national_id' && e.reason === 'pattern_mismatch'));
  check('stay_days → out_of_range', res.failed.some((e: any) => e.field === 'stay_days' && e.reason === 'out_of_range'));
  check('unlabeled field in needs_human', res.needs_human.some((n: any) => n.field === 'mystery'));

  const natId = res.failed.find((e: any) => e.field === 'national_id');
  check('Thai error string generated', typeof natId?.message_th === 'string' && natId.message_th.includes('รูปแบบไม่ถูกต้อง'), natId?.message_th);

  // needs_human means NOT filled: the DOM value must still be empty.
  const refEl = window.document.getElementById('mystery') as HTMLInputElement;
  check('needs_human field left empty in DOM', refEl.value === '', `"${refEl.value}"`);

  console.log('\nfill_form (self-correction retry):');
  const retry = JSON.parse(
    (await tools.fill_form.execute({ values: { national_id: '1234567890123', stay_days: '14' } })).content[0].text
  );
  check('corrected national_id now fills', retry.filled.includes('national_id'));
  check('corrected stay_days now fills', retry.filled.includes('stay_days'));

  console.log('\nread_form (accessibility read-back):');
  const readBack = JSON.parse((await tools.read_form.execute()).content[0].text);
  check('read_form returns all fields with labels', Array.isArray(readBack) && readBack.length === 11 && !!readBack[0].label);
  check('read_form marks required fields', readBack.find((f: any) => f.id === 'email')?.required === true);

  console.log('\nfill_form (needs_human resolved via confirmed):');
  const conf = JSON.parse(
    (await tools.fill_form.execute({ values: { mystery: 'ABC123' }, confirmed: ['mystery'] })).content[0].text
  );
  check('confirmed field bypasses needs_human and fills', conf.filled.includes('mystery'));
  check('confirmed field no longer flagged needs_human', !conf.needs_human.some((n: any) => n.field === 'mystery'));
  check('confirmed value written to DOM', (window.document.getElementById('mystery') as HTMLInputElement).value === 'ABC123');

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error('\nFAILURES:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
