// Fake `claude` for tests: reads stdin, writes the call to LEO_FAKE_LOG, answers according to LEO_FAKE_MODE.
import { appendFileSync } from 'node:fs';
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('9.9.9 (Claude Code)' + String.fromCharCode(10)); process.exit(0); }
if (argv.includes('--help')) { process.stdout.write('Usage: claude [options]' + String.fromCharCode(10) + (process.env.LEO_FAKE_NO_SAFE === '1' ? '' : '  --safe-mode  Start with all customizations disabled' + String.fromCharCode(10))); process.exit(0); }
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const mode = process.env.LEO_FAKE_MODE || 'ok';
  if (process.env.LEO_FAKE_LOG) {
    appendFileSync(process.env.LEO_FAKE_LOG, JSON.stringify({ args: process.argv.slice(2), input, inner: process.env.LEO_INNER }) + '\n');
  }
  const wrap = (obj) => JSON.stringify({ type: 'result', result: typeof obj === 'string' ? obj : JSON.stringify(obj), total_cost_usd: 0.0003 });
  const ok = { owner: { issues: [] }, skeptic: { issues: [], promises: [] } };
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  if (mode === 'fail') { process.stderr.write('boom'); process.exit(1); }
  if (mode === 'garbage') { process.stdout.write(wrap('это не json')); return; }
  if (mode === 'rawgarbage') { process.stdout.write('<<<не json вообще>>>'); return; }
  if (mode === 'fenced') { process.stdout.write(wrap('```json\n' + JSON.stringify({ owner: { issues: [{ severity: 'serious', text: 'жаргон: «хук»' }] }, skeptic: { issues: [] } }) + '\n```')); return; }
  if (mode === 'owner') { process.stdout.write(wrap({ owner: { issues: [{ severity: 'serious', text: 'Непонятно, что владельцу делать: нет кнопки «да/нет»' }] }, skeptic: { issues: [] } })); return; }
  if (mode === 'skeptic') { process.stdout.write(wrap({ owner: { issues: [] }, skeptic: { issues: [{ severity: 'serious', text: 'Сказано «слито», но нет номера коммита' }], promises: [] } })); return; }
  if (mode === 'minor') { process.stdout.write(wrap({ owner: { issues: [{ severity: 'minor', text: 'длинновато' }] }, skeptic: { issues: [{ severity: 'minor', text: 'мелочь' }] } })); return; }
  if (mode === 'promises') { process.stdout.write(wrap({ owner: { issues: [] }, skeptic: { issues: [], promises: ['Проверить окно alpha после обеда', 'Слить PR 12'] } })); return; }
  if (mode === 'hint') { process.stdout.write(wrap({ owner: { issues: [] }, skeptic: { issues: [], promises: [] }, rule_hint: { text: 'Не сливать PR без проверки на стенде', quote: 'больше без стенда не сливай' } })); return; }
  if (mode === 'hintblock') { process.stdout.write(wrap({ owner: { issues: [{ severity: 'serious', text: 'жаргон' }] }, skeptic: { issues: [] }, rule_hint: { text: 'Отвечать короче', quote: 'пиши короче' } })); return; }
  if (mode === 'hintbad') { process.stdout.write(wrap({ owner: { issues: [] }, skeptic: { issues: [] }, rule_hint: 'просто строка' })); return; }
  if (mode === 'many') { process.stdout.write(wrap({ owner: { issues: ['1','2','3','4','5'].map((n) => ({ severity: 'serious', text: 'находка ' + n + ' '.repeat(1) + 'x'.repeat(400) })) }, skeptic: { issues: [] } })); return; }
  process.stdout.write(wrap(ok));
});
