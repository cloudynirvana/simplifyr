#!/usr/bin/env node
// Telegram alerts. Setup: create a bot with @BotFather (/newbot) -> TELEGRAM_BOT_TOKEN; send your bot any message,
// then `node trading/telegram.mjs chatid` prints TELEGRAM_CHAT_ID. Put both in .env.local on the VPS.
import './lib.mjs'; // loads .env.local

const api = m => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${m}`;
export async function notify(msg) {
  console.log(new Date().toISOString(), msg);
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  await fetch(api('sendMessage'), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: msg.slice(0, 4000) }) }).catch(() => {});
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.TELEGRAM_BOT_TOKEN) { console.error('Set TELEGRAM_BOT_TOKEN in .env.local first'); process.exit(1); }
  if (process.argv[2] === 'chatid') {
    const r = await (await fetch(api('getUpdates'))).json();
    const c = r.result?.at(-1)?.message?.chat;
    console.log(c ? `TELEGRAM_CHAT_ID=${c.id}` : 'No messages yet: send your bot a message in Telegram, then rerun.');
  } else { await notify('GMGN paper bot: Telegram connected'); }
}
