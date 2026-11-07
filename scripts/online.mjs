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

const children = [];
let stopping = false;
const stop = () => {
  stopping = true;
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
[online]   Ou passez par le tunnel de secours (port 443, coupé au bout de 60 min) :
[online]     TUNNEL=pinggy PORT=${port} npm run online
`);
}

function startTunnel(args, onLine) {
  const tunnel = spawn(bin, pinggy ? args : ['tunnel', '--no-autoupdate', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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
        if (!pinggy && /ERR|WRN|Registered tunnel connection/.test(line)) console.log('[tunnel]', line.replace(/^\S+\s/, ''));
        if (pinggy && /error|denied|refused|timed out|expire/i.test(line)) console.log('[tunnel]', line.trim());
        if (/Allow outbound (QUIC|TCP).*7844/.test(line)) explainBlocked();
        if (/Registered tunnel connection/.test(line) && blockedShown) console.log('[online] tunnel connecté, tout va bien.');
        onLine?.(line);
      }
    });
  }
  tunnel.on('exit', (code) => {
    console.error(`[tunnel] ${pinggy ? 'le tunnel Pinggy' : 'cloudflared'} s’est arrêté (code ${code}).${pinggy && !stopping ? ' Relancez la même commande : la partie reprend.' : ''}`);
    if (stopping && children.length > 1) return; // Ctrl+C: wait for the quiz to save and close
    stop();
    process.exit(1);
  });
}

if (pinggy) {
  console.log('[online] ouverture d’un tunnel de secours Pinggy (port 443, 60 min maximum)…');
  let started = false;
  const args = ['-tt', '-p', '443', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes'];
  startTunnel([...args, `-R0:127.0.0.1:${port}`, 'free@a.pinggy.io'], (line) => {
    const m = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pinggy\.(?:link|online)/.exec(line);
    if (m && !started) {
      started = true;
      startServer(m[0]);
      console.log('[online] tunnel Pinggy ouvert. Il se coupe au bout de 60 minutes : relancez alors la même commande.');
    }
  });
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
