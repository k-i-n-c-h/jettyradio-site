import { spawn, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const worker = `${root}desk-worker`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error('Use Node.js 22.12 or newer, then retry.');
  process.exit(1);
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? `${command} failed. Fix the error above and retry.`);
    process.exit(result.status || 1);
  }
}

const action = process.argv[2];
if (action === 'setup') {
  try {
    copyFileSync(`${root}.env.example`, `${root}.env`, constants.COPYFILE_EXCL);
    console.log('Created .env from .env.example.');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('Keeping your existing .env unchanged.');
  }
  run(npm, ['install', '--no-package-lock']);
  run(npm, ['ci'], worker);
  run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'jettyradio-desk', '--local'], worker);
  console.log('\nSetup complete. Fill in the Clerk settings in .env, then run npm run dev.');
} else if (action === 'dev') {
  const astro = `${root}node_modules/astro/bin/astro.mjs`;
  const wrangler = `${worker}/node_modules/wrangler/bin/wrangler.js`;
  if (![`${root}.env`, astro, wrangler].every(existsSync)) {
    console.error('Run npm run setup first to create .env and install both apps.');
    process.exit(1);
  }
  const env = parseEnv(readFileSync(`${root}.env`, 'utf8'));
  const required = ['PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'PUBLIC_DESK_API_URL', 'CLERK_ISSUER', 'CLERK_ALLOWED_USER_IDS', 'CLERK_JWT_KEY', 'ALLOWED_ORIGINS'];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) {
    console.error(`Fill in these .env settings before starting the desk: ${missing.join(', ')}. See README.md.`);
    process.exit(1);
  }
  const api = new URL(env.PUBLIC_DESK_API_URL);
  if (api.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(api.hostname) || !api.port || api.pathname !== '/' || api.search || api.hash || api.username || api.password) {
    console.error('For local development, set PUBLIC_DESK_API_URL to http://localhost:8787 (or another local port).');
    process.exit(1);
  }
  const children = [];
  let stopping = false;
  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
    const timeout = setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    }, 5000);
    timeout.unref();
  }
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  for (const [name, args, cwd] of [
    ['Worker', [wrangler, 'dev', '--env-file', '../.env', '--ip', api.hostname, '--port', api.port], worker],
    ['Astro', [astro, 'dev', '--host', 'localhost', '--port', '4321'], root],
  ]) {
    const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
    children.push(child);
    child.on('error', error => {
      console.error(`${name}: ${error.message}`);
      stop(1);
    });
    child.on('exit', code => {
      if (!stopping) {
        console.error(`${name} stopped; shutting down local development.`);
        stop(code || 1);
      }
    });
  }
  console.log('Starting site at http://localhost:4321 and desk API at ' + api.origin + '. Press Ctrl+C to stop both.');
} else {
  console.error('Use npm run setup or npm run dev.');
  process.exit(1);
}
