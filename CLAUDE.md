# DeFi Project

A DeFi application that deposits SOL collateral on Kamino (Solana), borrows USDC, bridges it to Base via Mayan, and reverses the process to close the position.

## Architecture

- `src/config.ts` — Constants: market address, token mints, RPC URLs
- `src/services/wallet.ts` — Solana keypair + Base ethers wallet from .env
- `src/services/kamino.ts` — Kamino lending: deposit, borrow, repay, withdraw
- `src/services/mayan.ts` — Mayan bridge: bridgeToBase, bridgeToSolana, waitForBridge
- `src/services/pipeline.ts` — End-to-end: openPosition, closePosition
- `src/index.ts` — CLI entry point
- `agent/` — Agentic build system (coding agent, review agent, orchestrator)

## SDK Constraints

- **Kamino** (`@kamino-finance/klend-sdk`) uses `@solana/kit` v2 types (Address, TransactionSigner, Rpc)
- **Mayan** (`@mayanfinance/swap-sdk`) uses `@solana/web3.js` v1 types (PublicKey, Keypair, Connection)
- **Never mix v1 and v2 types** in the same function call
- `wallet.ts` is the compatibility boundary — it exports both v1 and v2 representations
- Use `@solana/compat` for conversions (`fromLegacyKeypair()`)

## Key Addresses

- Kamino main market: `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF`
- Kamino LUT: `284iwGtA9X9aLy3KsyV8uT2pXLARhYbiSi5SiM2g47M2`
- USDC Solana mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- USDC Base contract: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- SOL mint: `So11111111111111111111111111111111111111112`

## Build & Run

```bash
npm install
npx tsx src/index.ts open    # deposit SOL → borrow USDC → bridge to Base
npx tsx src/index.ts close   # bridge back → repay USDC → withdraw SOL
```

## Code Style

- TypeScript, ES2022, NodeNext modules, strict mode
- Async/await for all blockchain operations
- Conventional commits: feat(scope): description
- Small atomic commits per file/feature

## Kamino SDK Pattern

```typescript
import { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID } from '@kamino-finance/klend-sdk';

const market = await KaminoMarket.load(rpc, MAIN_MARKET, slotDuration);
const action = await KaminoAction.buildDepositTxns(market, amount, mint, wallet, new VanillaObligation(PROGRAM_ID));
const ixs = [...action.setupIxs, ...action.lendingIxs, ...action.cleanupIxs];
```

## Mayan SDK Pattern

```typescript
import { fetchQuote, swapFromSolana, swapFromEvm } from '@mayanfinance/swap-sdk';

// Solana → Base
const quotes = await fetchQuote({ amountIn64, fromToken, toToken, fromChain: 'solana', toChain: 'base', slippageBps: 'auto' });
await swapFromSolana(quotes[0], walletAddress, destinationAddress, null, signTransaction, connection);

// Base → Solana
await swapFromEvm(quotes[0], evmAddress, solanaAddress, null, ethSigner);

// Track status
const resp = await fetch(`https://explorer-api.mayan.finance/v3/swap/trx/${txHash}`);
// clientStatus: "INPROGRESS" | "COMPLETED" | "REFUNDED"
```
