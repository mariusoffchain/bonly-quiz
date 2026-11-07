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
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8787);
const bin = process.env.CLOUDFLARED ?? 'cloudflared';
const entry = path.join(root, 'dist/server/server/index.js');

if (!fs.existsSync(entry)) {
  console.error('Lancez d’abord : npm run build');
  process.exit(1);
}
if (spawnSync(bin, ['--version']).error) {
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
Fermez-le, ou lancez le quiz sur un autre port :
  PORT=8788 npm run online`);
  process.exit(1);
}

const children = [];
const stop = () => {
  for (const c of children) c.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function startServer(publicUrl) {
  const server = spawn(process.execPath, [entry], { env: { ...process.env, PORT: String(port), PUBLIC_URL: publicUrl }, stdio: 'inherit' });
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
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
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
    stop();
    process.exit(1);
  });
}

if (process.env.TUNNEL_TOKEN) {
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
