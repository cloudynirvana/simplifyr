#!/usr/bin/env node
// Live view. Binds to 127.0.0.1 ONLY (no auth). From your laptop: ssh -L 8787:127.0.0.1:8787 user@vps -> http://localhost:8787
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { readJournal } from './lib.mjs';
import { computeStats } from './stats.mjs';

const STATE = new URL('./state.json', import.meta.url).pathname;
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);

createServer((req, res) => {
  const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { watch: {}, pos: {}, rejected: {} };
  const j = readJournal(), s = computeStats(j);
  const recent = j.filter(r => ['fill', 'close', 'signal'].includes(r.event)).slice(-25).reverse();
  const row = r => `<tr><td>${new Date(r.ts).toISOString().slice(5, 19)}</td><td>${r.event}</td><td>${esc(r.sym ?? r.token?.slice(0, 6) ?? '')}</td><td>${esc(r.side ?? r.reason ?? '')}</td><td>${r.ok === false ? 'FAILED ' + r.reason : r.pnlUsd !== undefined ? money(r.pnlUsd) : r.usd ? money(r.usd) : ''}</td></tr>`;
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=15><title>GMGN paper bot</title>
<style>body{font:14px system-ui;margin:16px;background:#111;color:#ddd}td,th{padding:3px 10px;text-align:left}h2{margin:18px 0 6px}</style>
<h2>PAPER MODE metrics</h2><pre>${esc(JSON.stringify(s, null, 1))}</pre>
<h2>Open positions (${Object.keys(st.pos).length})</h2><pre>${esc(JSON.stringify(st.pos, null, 1))}</pre>
<h2>Watchlist (${Object.keys(st.watch).length})</h2><pre>${esc(JSON.stringify(st.watch, null, 1))}</pre>
<h2>Recent events</h2><table>${recent.map(row).join('')}</table>`);
}).listen(Number(process.env.DASH_PORT ?? 8787), '127.0.0.1');
