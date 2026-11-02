#!/usr/bin/env node
/**
 * Puts a game exported from the console ("Exporter la partie") back into data/,
 * so `npm run online` or `npm start` resumes it, on this computer or another one.
 *
 *   node scripts/restore.mjs bonly-quiz-ABCD.json
 *
 * Stop the server first. Players get their seat back with their recovery code
 * (or automatically if the quiz address did not change).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
if (!file) {
  console.error('Usage : node scripts/restore.mjs bonly-quiz-XXXX.json');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data');

const { snapshot, events } = JSON.parse(fs.readFileSync(file, 'utf8'));
if (snapshot?.version !== 2 || !snapshot.code) {
  console.error('Ce fichier ne ressemble pas à un export de la console (snapshot version 2 attendu).');
  process.exit(1);
}
const sessions = path.join(dataDir, 'sessions');
fs.mkdirSync(sessions, { recursive: true });
fs.writeFileSync(path.join(sessions, `${snapshot.code}.json`), JSON.stringify(snapshot));
if (Array.isArray(events)) fs.writeFileSync(path.join(sessions, `${snapshot.code}.events.jsonl`), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
fs.writeFileSync(path.join(dataDir, 'current.json'), JSON.stringify({ code: snapshot.code, updatedAt: Date.now() }));

const players = Object.values(snapshot.players).filter((p) => !p.removed).length;
const where = snapshot.phase === 'lobby' ? 'avant la 1re question' : snapshot.phase === 'final' ? 'après la dernière question' : `question ${snapshot.current + 1}`;
console.log(`Partie ${snapshot.code} restaurée dans ${dataDir} : ${players} joueur${players > 1 ? 's' : ''}, ${where}.`);
console.log('Relancez maintenant : npm run online');
