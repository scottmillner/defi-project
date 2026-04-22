# DeFi Project

A DeFi application that executes a Solana lending + cross-chain bridging strategy:

1. Deposit SOL as collateral on Kamino (Solana)
2. Borrow USDC against that collateral
3. Bridge USDC to Base via Mayan
4. Close position: bridge back, repay, withdraw collateral

## Setup

```bash
npm install
cp .env.example .env
# Fill in SOLANA_PRIVATE_KEY and BASE_PRIVATE_KEY
```

## Usage

```bash
npx tsx src/index.ts open    # open position (deposit → borrow → bridge)
npx tsx src/index.ts close   # close position (bridge → repay → withdraw)
```

## Architecture

```
src/
├── config.ts              # Constants: market addresses, token mints, RPC URLs
├── services/
│   ├── wallet.ts          # Solana keypair + Base wallet (v1/v2 compatibility layer)
│   ├── kamino.ts          # Kamino lending: deposit, borrow, repay, withdraw
│   ├── mayan.ts           # Mayan bridge: Solana ↔ Base
│   └── pipeline.ts        # End-to-end position management
└── index.ts               # CLI entry point
```

## Agent System

An agentic build pipeline automates development via GitHub issues:

```
agent/
├── src/
│   ├── agents/
│   │   ├── coding-agent.ts    # Implements services autonomously
│   │   ├── review-agent.ts    # Reviews PRs against DeFi-specific rules
│   │   └── issue-agent.ts     # Creates GitHub issues for each service
│   ├── orchestrator.ts        # Coding → review loop (max 2 iterations)
│   ├── webhook.ts             # Hono server listening for GitHub events
│   ├── prompts.ts             # DeFi-specific system prompt
│   ├── rules.ts               # DeFi-specific review rules
│   ├── tools.ts               # Tool definitions (read, write, bash, git)
│   └── github.ts              # GitHub API wrapper
```

### Agent Workflow

```
Issue Agent creates GitHub issues (one per service)
  → GitHub webhook hits local server (via ngrok)
  → Orchestrator dispatches Coding Agent
  → Coding Agent implements service, opens PR
  → Review Agent reviews against rules
  → If approved: ready for merge
  → If changes needed: Coding Agent fixes, re-pushes
  → After 2 loops: escalates to human review
```

### Running the Agent Pipeline

```bash
cd agent
npm install
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, etc.

# Start webhook server
npm run webhook

# In another terminal, expose via ngrok
ngrok http 3000

# Create GitHub issues to trigger the pipeline
npm run issues
```

## Tech Stack

- **Kamino** (`@kamino-finance/klend-sdk`) — Solana lending protocol
- **Mayan** (`@mayanfinance/swap-sdk`) — Cross-chain bridge
- **@solana/kit** v2 — Solana client (used by Kamino)
- **@solana/web3.js** v1 — Solana client (used by Mayan)
- **ethers** v6 — Base/EVM wallet operations
- **Claude Agent SDK** — Agentic development pipeline
