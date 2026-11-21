import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../lib/secrets.mjs';
import { FK } from './helpers.mjs';

// Samples are assembled from pieces: nothing that looks like a real key may sit in the sources.
const j = (...p) => p.join('');
const POSITIVE = [
  ['openai-style key', FK.sk],
  ['github classic token', FK.ghp],
  ['github pat', FK.pat],
  ['slack bot', FK.xox],
  ['aws access key id', FK.akia],
  ['jwt', FK.jwt],
  ['telegram bot token', FK.tg],
  ['huggingface', FK.hf],
  ['supabase', FK.sbp],
  ['stripe live', j('sk_', 'live_', 'abcdefghijklmnopqrstuvwx')],
  ['stripe test restricted', j('rk_', 'test_', 'abcdefghijklmnopqrstuvwx')],
  ['google oauth', j('ya29', '.a0AfH6SMBabcdefghijklmnop')],
  ['slack app token', j('xapp', '-1-A0123-4567-abcdefghijkl')],
  ['bearer header', 'Authorization: Bearer abcdef1234567890abcdef'],
  ['url credentials', j('postgres://', 'admin:hunter2pass', '@db.example.com/app')],
  ['password colon', 'password: hunter2hunter2'],
  ['json password', '{"password": "hunter2hunter2"}'],
  ['dotenv api key', 'API_KEY=abcd1234efgh5678'],
  ['dotenv db password', 'DB_PASSWORD=correcthorsebattery'],
  ['dotenv secret', 'CLIENT_SECRET=zzzz9999yyyy8888'],
  ['credentials assignment', 'credentials: s3cr3tvalue99'],
  ['ru password colon', 'пароль: qwerty12345'],
  ['ru password space', 'пароль qwerty12345'],
  ['azure storage', j('AccountKey', '=', 'abcdefghijklmnopqrstuvwxyz0123456789ABCD==')],
  ['long hex secret', 'SECRET_KEY=' + 'a1b2c3d4'.repeat(8)],
  ['pem', FK.pem + '\nMIIEvQIBADANBgkqh\n-----END PRIVATE KEY-----'],
];

const NEGATIVE = [
  'C:\Studio\repos\norma-hr\.env',
  'see .env.example for the list of variables',
  'docs/credentials-guide.md',
  'src/config/dotenv.env.js',
  'open the file ~/.aws/credentials and check the region',
  'The token budget is 200k tokens per session',
  'Use a password manager for passwords',
  'пароль нужно хранить в менеджере паролей',
  'git commit -m "fix: rename secret handling module"',
  'https://github.com/zhichkin44-del/leo-claude-plugin',
  'sk-learn is not a key',
  'NODE_ENV=production',
  'PORT=3000',
  'LEO_HOME=/home/user/.claude/leo',
  'task-1234 merged into main at 12:30',
  'PR 12 slit, tests 57 pass',
  '/usr/local/bin/node --version',
  'cat .env | wc -l',
  'The pin is on the map',
  'Обычный текст про PR 12 и токены',
  'tests/fixtures/secrets-sample.txt',
  'a1b2c3d4 is a short commit id',
  'export PATH=$PATH:/usr/bin',
];

for (const [name, secret] of POSITIVE) {
  test('secret is masked: ' + name, () => {
    const out = redact('before ' + secret + ' after');
    assert.notEqual(out, 'before ' + secret + ' after');
    const core = secret.split(/[:= ]/).pop().replace(/[",}]/g, '');
    if (core.length > 8) assert.ok(!out.includes(core), 'value left in output: ' + out);
  });
}

test('at least 20 positive samples', () => assert.ok(POSITIVE.length >= 20));
test('at least 20 safe strings', () => assert.ok(NEGATIVE.length >= 20));

for (const s of NEGATIVE) {
  test('safe string is unchanged: ' + s.slice(0, 50), () => {
    assert.equal(redact(s), s);
  });
}

test('T-secret-1: path to .env stays, the value inside is masked', () => {
  const p = 'C:\Studio\repos\norma-hr\.env';
  assert.equal(redact(p), p);
  assert.equal(redact('прочитал ' + p + ' и увидел'), 'прочитал ' + p + ' и увидел');
  const o = redact(p + ': DB_PASSWORD=hunter2hunter2');
  assert.ok(o.startsWith(p));
  assert.ok(!o.includes('hunter2'));
});

test('.env contents: KEY=value lines are masked line by line, variable names stay', () => {
  const o = redact('DB_HOST=localhost\nAPI_KEY=abcd1234efgh5678\nPORT=3000');
  assert.match(o, /DB_HOST=localhost/);
  assert.match(o, /PORT=3000/);
  assert.match(o, /API_KEY=/);
  assert.ok(!o.includes('abcd1234efgh5678'));
});
