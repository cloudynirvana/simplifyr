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
exit $fail
