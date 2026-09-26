/**
 * Verification rapide de l'API deployee (smoke test apres deploiement Coolify).
 *
 * Utilisation :
 *   node scripts/smoke.mjs https://api.bodogui.com
 */
const base = (process.argv[2] || process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '');

const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  OK   ${name}${detail ? ` (${detail})` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    console.error(`  ECHEC ${name} : ${err.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

console.log(`Smoke test Bodogui -> ${base}`);

await check('GET /healthz', async () => {
  const res = await fetch(`${base}/healthz`);
  const body = await res.json();
  expect(res.status === 200, `statut ${res.status}`);
  expect(body.checks?.database === true, 'base de donnees indisponible');
  return `uptime ${body.uptime}s, storage ${body.checks.storage.driver}`;
});

await check('GET /api/v1/version', async () => {
  const res = await fetch(`${base}/api/v1/version`);
  const body = await res.json();
  expect(res.ok, `statut ${res.status}`);
  return body.version;
});

await check('GET /api/v1/bootstrap (categories)', async () => {
  const res = await fetch(`${base}/api/v1/bootstrap`);
  const body = await res.json();
  expect(res.ok, `statut ${res.status}`);
  expect(body.categories.length >= 5, 'jeu de categories incomplet (lancer npm run seed)');
  return `${body.categories.length} categories, ${body.districts.length} quartiers`;
});

await check('GET /api/v1/ads (fil public)', async () => {
  const res = await fetch(`${base}/api/v1/ads?limit=5`);
  const body = await res.json();
  expect(res.ok, `statut ${res.status}`);
  return `${body.items.length} annonces`;
});

await check('POST /api/v1/auth/request-code (numero invalide refuse)', async () => {
  const res = await fetch(`${base}/api/v1/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: 'abc' }),
  });
  expect(res.status === 400, `statut attendu 400, recu ${res.status}`);
  return 'validation active';
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verifications reussies`);
process.exit(failed.length ? 1 : 0);
