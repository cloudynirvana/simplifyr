# simplify

> AI-arbitrated escrow on Solana. Lock funds on-chain, complete milestones, let Noah AI resolve every dispute.

**Dev3Pack 2026 · Solana Mobile track**

---

## Stack

| Layer | Tech |
|---|---|
| On-chain | Anchor 0.29 · Rust |
| Frontend | Next.js 14 · TypeScript · React |
| Wallet | Solana Wallet Adapter · Phantom |
| AI Arbitration | Anthropic Claude (Noah agent) |
| IPFS | nft.storage (DeSci module) |
| Blockchain events | Helius webhooks |

---

## Quick start

### Prerequisites
- Node ≥ 18
- Rust + Cargo
- [Solana CLI](https://docs.solanalabs.com/cli/install)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation)

### 1 · Install deps
```bash
npm install
```

### 2 · Copy env
```bash
cp .env.local.example .env.local
# Fill in values — minimum: NEXT_PUBLIC_SOLANA_NETWORK and NEXT_PUBLIC_RPC_URL
```

### 3 · Start local validator
```bash
# Terminal 1
solana-test-validator --reset
```

### 4 · Build + deploy program
```bash
# Terminal 2
anchor build
anchor deploy --provider.cluster localnet

# Copy the deployed program ID and update:
#   - Anchor.toml [programs.localnet]
#   - .env.local NEXT_PUBLIC_ESCROW_PROGRAM_ID
#   - programs/escrow/src/lib.rs declare_id!()
# Then rebuild:
anchor build
```

### 5 · Run UI
```bash
# Terminal 3
NEXT_PUBLIC_SOLANA_NETWORK=localnet \
NEXT_PUBLIC_RPC_URL=http://localhost:8899 \
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Connect Phantom (custom RPC: `http://localhost:8899`). Airdrop SOL:
```bash
solana airdrop 10 <YOUR_WALLET> --url localhost
```

---

## Deployment stages

| Stage | Command | Notes |
|---|---|---|
| Local | `npm run dev` (localnet) | Instant, free, full flow |
| Devnet | `anchor deploy --provider.cluster devnet` | Real network, free SOL from faucet |
| Vercel preview | `vercel` | Catches SSR + env issues before prod |
| Betanet | Update `.env` → `vercel --prod` | Real SOL needed |

---

## Noah AI layer

| Route | Purpose |
|---|---|
| `POST /api/noah/webhook` | Helius event receiver |
| `POST /api/noah/dispute` | Claude dispute arbitration |
| `POST /api/noah/milestone` | Milestone evidence validator |

Configure Helius webhook:
1. Go to [Helius dashboard](https://dev.helius.xyz)
2. Create webhook → URL: `https://your-domain/api/noah/webhook`
3. Type: Enhanced · Addresses: your program ID · Events: ACCOUNT_CHANGE
4. Copy webhook secret → `HELIUS_WEBHOOK_SECRET` in env

---

## Post-IDL steps

After `anchor build` generates `target/idl/escrow.json`:

1. Copy to `idl/escrow.json`
2. In `escrowEngine.ts`, uncomment the IDL import and `new Program(IDL, ...)` line
3. Replace `deserialiseEscrowAccount` with `program.account.escrowState.fetch()`

---

## Remaining TODOs

- [ ] Wire real escrow list from program accounts (replace mock data in `dashboard.tsx`)
- [ ] Metaplex CPI for real estate deed NFT transfer in `lib.rs`
- [ ] Email/push notifications on escrow state changes
- [ ] Helius websocket subscriptions (replace polling in `useEscrow.ts`)
- [ ] Unit tests with anchor-bankrun

---

## Licence

MIT
