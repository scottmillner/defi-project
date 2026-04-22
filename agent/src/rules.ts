/**
 * Review rules for the PR Review Agent.
 * Update these rules to change how the agent evaluates pull requests.
 */

export const reviewRules = `
## Code Review Rules

### SDK Correctness
- Kamino operations must use @solana/kit v2 types (Address, TransactionSigner, Rpc) — never @solana/web3.js v1
- Mayan operations must use @solana/web3.js v1 types (PublicKey, Keypair, Connection) — never v2
- The two must never be mixed in the same function call
- @solana/compat must be used for conversions at the wallet boundary

### Wallet Correctness
- Solana keypair must be loaded from SOLANA_PRIVATE_KEY env var
- Base wallet must be loaded from BASE_PRIVATE_KEY env var
- Private keys must never be logged or exposed in output
- wallet.ts must export both v1 and v2 Solana representations plus ethers Wallet

### Kamino Correctness
- Market must be loaded via KaminoMarket.load() with address 7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF
- Obligation type must be VanillaObligation(PROGRAM_ID)
- Actions must use buildDepositTxns/buildBorrowTxns/buildRepayTxns/buildWithdrawTxns
- Amounts must be in base units (lamports for SOL, 1e6 for USDC) using BN

### Mayan Correctness
- Quote must be fetched with amountIn64 (not deprecated amount field)
- slippageBps must be set (either 'auto' or a number)
- Bridge tracking must poll the explorer API and wait for COMPLETED status
- EVM→Solana swaps must approve the Mayan forwarder contract for ERC20 tokens

### Pipeline Correctness
- openPosition must call: deposit → borrow → bridge to Base (in order)
- closePosition must call: bridge to Solana → repay → withdraw (in order)
- Each step must await the previous step's completion
- Bridge operations must wait for confirmation before proceeding

### Code Style
- All service functions must be async
- Errors must be descriptive (include which step failed and relevant tx/address)
- Each step must log what it is doing
- No hardcoded private keys

### Completeness
- Each service must export all specified functions
- Config must define all required constants
- Imports from config.ts must use the defined constants, not hardcoded strings

### Review Outcome
- APPROVE if all rules pass
- REQUEST_CHANGES if any rule is violated — cite the specific rule and line number
`;
