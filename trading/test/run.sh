#!/usr/bin/env bash
# Offline regression tests: a fake gmgn-cli feeds scripted market states; NO network, NO API key, NO real orders.
# Run from anywhere: bash trading/test/run.sh   (moves your journal/state/wallets aside and restores them after)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
export SIM="$(mktemp -d)" PATH="$ROOT/trading/test/fake:$PATH" TYPESAFE_API_KEY= GMGN_API_KEY=fake QUOTE_SOURCE=model LATENCY_S=0 FAIL_RATE=0 TELEGRAM_BOT_TOKEN= SOURCES=smart,trending
B="$SIM/backup"; mkdir -p "$B"; for f in journal.jsonl state.json wallets.json orders.jsonl; do [ -f trading/$f ] && mv trading/$f "$B/"; done
restore() { rm -f trading/journal.jsonl trading/state.json; for f in "$B"/*; do [ -e "$f" ] && mv "$f" trading/; done; rm -rf "$SIM"; }
trap restore EXIT
sc() { echo "$1" > "$SIM/scenario.json"; }
run() { node trading/bot.mjs --once >/dev/null; }
reasons() { { grep -o '"reason":"[a-z_%0-9-]*"' trading/journal.jsonl || true; } | cut -d'"' -f4 | tr '\n' ' '; }
BASE='"liq":80000,"ageS":3600,"devBal":1000,"b1":700,"s1":300,"b5":3000,"s5":2500,"lastGreen":true'
fail=0; check() { if [ "$1" = "$2" ]; then echo "PASS $3"; else echo "FAIL $3 (got: $1)"; fail=1; fi; }
t() { rm -f trading/journal.jsonl trading/state.json; sc "{\"px\":1.4,$BASE,\"klEnd\":1.4}"; run; run; sc "$1"; run; [ "${2:-}" = twice ] && run; reasons; }
check "$(t "{\"px\":1.5,\"liq\":40000,\"ageS\":3600,\"devBal\":1000,\"b1\":700,\"s1\":300,\"b5\":3000,\"s5\":2500,\"klEnd\":1.5,\"lastGreen\":true}")" "liquidity_pulled " "liquidity pull exit"
check "$(t "{\"px\":1.4,$BASE,\"devBal\":10,\"klEnd\":1.4}")" "dev_sold " "dev sold exit"
check "$(t "{\"px\":1.6,$BASE,\"klEnd\":1.6}" && sc "{\"px\":1.3,\"liq\":80000,\"ageS\":3600,\"devBal\":1000,\"b1\":100,\"s1\":900,\"b5\":1000,\"s5\":3000,\"klEnd\":1.3,\"lastGreen\":false}" && run && reasons)" "sell_wave " "sell wave exit (after a new peak)"
check "$(t "{\"px\":1.45,$BASE,\"klEnd\":1.45,\"smartSell\":true}" twice)" "smart_money_selling " "smart money selling exit"
rm -f trading/journal.jsonl trading/state.json; sc "{\"px\":1.4,\"liq\":5000,\"ageS\":120,\"devBal\":1000,\"b1\":700,\"s1\":300,\"b5\":3000,\"s5\":2500,\"klEnd\":1.4,\"lastGreen\":true}"; run
check "$(grep -c '"event":"deferred"' trading/journal.jsonl)" "1" "too-new token deferred, not banned"
rm -f trading/journal.jsonl trading/state.json; sc "{\"px\":1.4,\"liq\":15000,\"ageS\":3600,\"devBal\":1000,\"b1\":700,\"s1\":300,\"b5\":3000,\"s5\":2500,\"klEnd\":1.4,\"lastGreen\":true}"; run
check "$(grep -o '"strategy":"shadow:low_liquidity"' trading/journal.jsonl | head -1)" '"strategy":"shadow:low_liquidity"' "near-miss goes to shadow cohort"
rm -f trading/journal.jsonl trading/state.json; sc "{\"px\":1.4,$BASE,\"klEnd\":1.4,\"trending\":true}"; SOURCES=trending run
check "$(grep -o '"strategy":"trending"' trading/journal.jsonl | head -1)" '"strategy":"trending"' "trending source entry"
rm -f trading/journal.jsonl; node -e 'const r={};for(let k=0;k<600;k++)r["R"+k]={sym:"R"+k,ts:1000+k};require("fs").writeFileSync("trading/state.json",JSON.stringify({rejected:r}))'
sc "{\"px\":1.4,$BASE,\"klEnd\":1.4}"; run
check "$(node -e 'const r=JSON.parse(require("fs").readFileSync("trading/state.json")).rejected;console.log(Object.keys(r).length+" "+("R599" in r)+" "+("R0" in r))')" "500 true false" "rejected list capped at 500, newest kept"
# --- looser shadow cohort `shadow:loose` (CALIBRATION.md section 11): liq>=15k, age>=10m, bundlers<=35%; nothing else relaxed ---
cnt() { { grep -c "$1" trading/journal.jsonl || true; } | head -1; }
loose() { rm -f trading/journal.jsonl trading/state.json; sc "{\"px\":1.4,\"liq\":$1,\"ageS\":$2,\"devBal\":1000,\"b1\":700,\"s1\":300,\"b5\":3000,\"s5\":2500,\"klEnd\":1.4,\"lastGreen\":true,\"bundler\":$3,\"honeypot\":${4:-0}}"; run; }
loose 20000 700 0.05
check "$(cnt '"event":"entry".*"strategy":"shadow:loose"')/$(cnt '"event":"entry"')" "1/1" "loose cohort: liq 20k + age 11m enters as shadow:loose, and only as shadow"
loose 12000 700 0.05
check "$(cnt 'shadow:loose')/$(cnt '"event":"deferred"')" "0/1" "loose cohort: liq below 15k is not loose (stays deferred)"
loose 20000 400 0.05
check "$(cnt 'shadow:loose')/$(cnt '"event":"deferred"')" "0/1" "loose cohort: age below 10m is not loose (stays deferred)"
loose 20000 3600 0.30
check "$(cnt '"event":"entry".*"strategy":"shadow:loose"')" "1" "loose cohort: liq 20k + bundlers 30% enters as shadow:loose"
loose 20000 3600 0.40
check "$(cnt 'shadow:loose')/$(cnt '"event":"reject"')" "0/1" "loose cohort: bundlers above 35% is rejected"
loose 20000 700 0.05 1
check "$(cnt 'shadow:loose')" "0" "loose cohort: honeypot is never relaxed"
SHADOW_LOOSE=0 loose 20000 700 0.05
check "$(cnt 'shadow:loose')/$(cnt '"event":"deferred"')" "0/1" "loose cohort: SHADOW_LOOSE=0 switches it off"
# VERSION must describe the code in this tree: codehash = sha256 over sorted trading/*.mjs (name + bytes), first 12 hex (same as bot.mjs fingerprint()).
HASH="$(node -e 'const fs=require("fs"),c=require("crypto"),h=c.createHash("sha256");for(const f of fs.readdirSync("trading").filter(f=>f.endsWith(".mjs")).sort())h.update(f).update(fs.readFileSync("trading/"+f));console.log(h.digest("hex").slice(0,12))')"
check "$(sed -n 's/^codehash=\([0-9a-f]*\).*/\1/p' trading/VERSION 2>/dev/null)" "$HASH" "trading/VERSION codehash matches the code (is $HASH)"
node trading/test/unit.mjs || fail=1     # offline unit tests (counters, retries, ...)
exit $fail
