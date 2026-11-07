#!/usr/bin/env node
/**
 * Puts the quiz online through a Cloudflare Tunnel, so phones join over 4G or
 * any Wi-Fi: the server keeps running on this computer, Cloudflare gives it a
 * public HTTPS address, and the QR code points there.
 *
 *   npm run build
 *   npm run online
 *
 * Without settings: a temporary *.trycloudflare.com address (no account needed,
 * new address at every start, no uptime guarantee).
 * With TUNNEL_TOKEN and PUBLIC_URL: a named tunnel on your own domain, e.g.
 *   TUNNEL_TOKEN=eyJ... PUBLIC_URL=https://quiz.b-only.org npm run online
 *
 * Needs the cloudflared program (CLOUDFLARED=/path/to/cloudflared to pick one).
 *
 * Backup when the network blocks Cloudflare's tunnel port (7844, common on hotel or
 * company Wi-Fi): TUNNEL=pinggy npm run online opens a free Pinggy tunnel over SSH on
 * port 443, with the ssh already on macOS. Free Pinggy tunnels stop after 60 minutes:
 * relaunch, the game resumes and the QR code shows the new address.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8787);
const pinggy = process.env.TUNNEL === 'pinggy';
const bin = pinggy ? 'ssh' : (process.env.CLOUDFLARED ?? 'cloudflared');
const entry = path.join(root, 'dist/server/server/index.js');

if (!fs.existsSync(entry)) {
  console.error('Lancez d’abord : npm run build');
  process.exit(1);
}
if (pinggy ? spawnSync(bin, ['-V']).error : spawnSync(bin, ['--version']).error) {
  if (pinggy) {
    console.error('ssh est introuvable sur cet ordinateur.');
    process.exit(1);
  }
  console.error(`cloudflared est introuvable. Installation :
  macOS    brew install cloudflared
  Windows  winget install --id Cloudflare.cloudflared
  Linux    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
  process.exit(1);
}

/** True if something already answers on this computer's own address at `port`. */
const portTaken = (host) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port });
    s.setTimeout(800);
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('timeout', () => (s.destroy(), resolve(false)));
    s.once('error', () => resolve(false));
  });
// Another program on 127.0.0.1 or ::1 (a dev server, a quiz started in another terminal)
// would receive the tunnel's visitors instead of the quiz, which listens on all addresses.
if ((await portTaken('127.0.0.1')) || (await portTaken('::1'))) {
  console.error(`Le port ${port} est déjà utilisé par un autre programme sur cet ordinateur
(un autre serveur de développement, ou le quiz déjà lancé dans un autre terminal).
Pour voir lequel : lsof -i :${port}
Si c'est un ancien quiz resté ouvert, pour l'arrêter :
  kill $(lsof -t -iTCP:${port} -sTCP:LISTEN)
puis relancez. Sinon, lancez le quiz sur un autre port :
  PORT=${port + 1} npm run online`);
  process.exit(1);
}

// Pinggy only works like a hand-typed ssh: it needs this terminal (its size, the password
// prompt), so ssh gets our keyboard and switches the terminal to raw mode while it runs.
// In raw mode a bare \n no longer returns to the start of the line: add the \r ourselves.
const sharedTty = pinggy && process.stdin.isTTY;
if (sharedTty) {
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => write(String(chunk).replace(/\r?\n/g, '\r\n'), ...rest);
  }
}

const children = [];
let stopping = false;
const stop = () => {
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function startServer(publicUrl) {
  const server = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port), PUBLIC_URL: publicUrl },
    stdio: sharedTty ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (sharedTty) {
    server.stdout.on('data', (d) => process.stdout.write(d));
    server.stderr.on('data', (d) => process.stderr.write(d));
  }
  children.push(server);
  server.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });
  console.log(`\n[online] adresse publique : ${publicUrl}`);
  console.log(`[online] sur cet ordinateur, ouvrez http://localhost:${port}/board et http://localhost:${port}/console\n`);
}

/** Printed once when cloudflared cannot reach Cloudflare: the network blocks port 7844. */
let blockedShown = false;
function explainBlocked() {
  if (blockedShown) return;
  blockedShown = true;
  console.error(`
[online] ⚠ Le réseau de cet ordinateur bloque le tunnel (port 7844, UDP et TCP) :
[online]   les téléphones ne pourront pas se connecter tant que ce message revient.
[online]   Branchez l'ordinateur sur le partage de connexion d'un téléphone (ou un autre
[online]   Wi-Fi), puis Ctrl + C et relancez la même commande.
[online]   Ou passez par le tunnel de secours (port 443, coupé au bout de 60 min) :
[online]     TUNNEL=pinggy PORT=${port} npm run online
`);
}

function startTunnel(args, onLine) {
  const tunnel = spawn(bin, ['tunnel', '--no-autoupdate', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(tunnel);
  for (const stream of [tunnel.stdout, tunnel.stderr]) {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) {
        // eslint-disable-next-line no-control-regex
        const line = buf.slice(0, i).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        buf = buf.slice(i + 1);
        if (/ERR|WRN|Registered tunnel connection/.test(line)) console.log('[tunnel]', line.replace(/^\S+\s/, ''));
        if (/Allow outbound (QUIC|TCP).*7844/.test(line)) explainBlocked();
        if (/Registered tunnel connection/.test(line) && blockedShown) console.log('[online] tunnel connecté, tout va bien.');
        onLine?.(line);
      }
    });
  }
  tunnel.on('exit', (code) => {
    console.error(`[tunnel] cloudflared s’est arrêté (code ${code}).`);
    const serverRunning = children.length > 1;
    stop();
    // Let the quiz save and close first; its own exit ends this process.
    if (!serverRunning) process.exit(1);
  });
}

const PINGGY_URL = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pinggy(?:-free)?\.(?:link|net|online)/;

/**
 * Pinggy over ssh, run as close as possible to the hand-typed command that works
 * (ssh -p 443 -R0:localhost:PORT free.pinggy.io): ssh shares this terminal, and its screen
 * is shown as is until the public address is found, either in that screen or from
 * Pinggy's local web debugger (forwarded to PORT+1000).
 */
function startPinggy() {
  console.log('[online] ouverture d’un tunnel de secours Pinggy (port 443, 60 min maximum)…');
  console.log('[online] si un mot de passe est demandé, appuyez simplement sur Entrée.');
  console.log('[online] pour tout arrêter : Ctrl + C. Si rien ne se passe : Entrée, puis ~ puis . (point).');
  const debugPort = port + 1000;
  const args = ['-t', '-p', '443', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-o', 'PubkeyAuthentication=no'];
  const ssh = spawn(bin, [...args, '-L', `${debugPort}:localhost:4300`, `-R0:localhost:${port}`, 'free.pinggy.io'], {
    stdio: [sharedTty ? 'inherit' : 'ignore', 'pipe', 'pipe'],
  });
  children.push(ssh);

  let started = false;
  let seen = '';
  const found = (url) => {
    if (started) return;
    started = true;
    clearInterval(poll);
    console.log('\n');
    startServer(url);
    console.log('[online] tunnel Pinggy ouvert. Il se coupe au bout de 60 minutes : relancez alors la même commande.');
  };
  ssh.stdout.on('data', (d) => {
    if (started) return; // Pinggy's screen has done its job; keep the quiz's lines readable
    process.stdout.write(d);
    seen = (seen + d.toString()).slice(-20000);
    // eslint-disable-next-line no-control-regex
    const text = seen.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[()][0-9A-Za-z]/g, '');
    const m = PINGGY_URL.exec(text);
    if (m) found(m[0]);
  });
  ssh.stderr.on('data', (d) => {
    // Our probes of the debugger port make ssh complain while it is not ready: hide that.
    const text = d.toString().split(/\r?\n/).filter((l) => l.trim() && !/channel \d+: open failed|connect_to localhost/.test(l));
    if (text.length) process.stderr.write(text.join('\n') + '\n');
  });
  let tries = 0;
  const poll = setInterval(async () => {
    if (++tries > 40) return clearInterval(poll);
    try {
      const r = await fetch(`http://127.0.0.1:${debugPort}/urls`, { signal: AbortSignal.timeout(1500) });
      const m = PINGGY_URL.exec(await r.text());
      if (m) found(m[0]);
    } catch {}
  }, 1500);
  ssh.on('exit', (code) => {
    clearInterval(poll);
    console.error(`\n[tunnel] le tunnel Pinggy s’est arrêté (code ${code}).${stopping ? '' : ' Relancez la même commande : la partie reprend.'}`);
    const serverRunning = children.length > 1;
    stop();
    if (!serverRunning) process.exit(1);
  });
}

if (pinggy) {
  startPinggy();
} else if (process.env.TUNNEL_TOKEN) {
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl) {
    console.error('Avec TUNNEL_TOKEN, indiquez aussi PUBLIC_URL (ex. https://quiz.b-only.org).');
    process.exit(1);
  }
  startTunnel(['run', '--token', process.env.TUNNEL_TOKEN]);
  startServer(publicUrl);
} else {
  console.log('[online] ouverture d’un tunnel temporaire trycloudflare.com…');
  let started = false;
  startTunnel(['--url', `http://127.0.0.1:${port}`], (line) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line);
    if (m && !started) {
      started = true;
      startServer(m[0]);
    }
  });
}
