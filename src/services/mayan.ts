/**
 * mayan.ts — Mayan bridge service.
 *
 * Functions:
 *  - bridgeToBase(amountUsdcUnits)   : bridge USDC from Solana → Base
 *  - bridgeToSolana(amountUsdcUnits) : bridge USDC from Base   → Solana
 *  - waitForBridge(txHash)           : poll Mayan explorer until COMPLETED / REFUNDED
 *
 * IMPORTANT: All Mayan SDK calls use @solana/web3.js v1 types (Keypair, Connection).
 * Never pass v2 / @solana/kit types here.
 *
 * NOTE on ethers dual-module boundary: the Mayan SDK bundles its own CJS copy
 * of ethers while this project uses the ESM entry-point.  Both are functionally
 * identical at runtime but TypeScript sees them as distinct types.  We bridge
 * the gap with `as unknown as <Target>` casts at the two call sites — this is
 * intentional and does not affect runtime behaviour.
 */

import {
  fetchQuote,
  swapFromSolana,
  swapFromEvm,
  type Quote,
  type SolanaTransactionSigner,
} from "@mayanfinance/swap-sdk";
import { ethers } from "ethers";

import {
  USDC_MINT_SOLANA,
  USDC_CONTRACT_BASE,
  MAYAN_FORWARDER_CONTRACT_BASE,
  MAYAN_EXPLORER_API,
} from "../config.js";

import {
  v1Keypair,
  connection,
  signTransaction,
  getBaseWallet,
} from "./wallet.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status values returned by the Mayan explorer API. */
type MayanClientStatus = "INPROGRESS" | "COMPLETED" | "REFUNDED";

interface MayanExplorerResponse {
  clientStatus: MayanClientStatus;
  [key: string]: unknown;
}

/** Return shape shared by bridgeToBase and bridgeToSolana */
export interface BridgeResult {
  txHash: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert USDC base units (6 decimals) to the string representation that
 * Mayan expects for amountIn64 (human-readable amount with decimals, e.g. "5"
 * for 5 USDC or "5.000000" — Mayan resolves decimals from the token mint).
 */
function usdcUnitsToString(units: number): string {
  // Mayan amountIn64 accepts the human-readable amount as a string.
  // 1 USDC = 1_000_000 base units.
  return (units / 1_000_000).toString();
}

/**
 * Fetch the best quote for a USDC → USDC bridge between two chains.
 */
async function fetchBestQuote(
  amountIn64: string,
  fromToken: string,
  fromChain: "solana" | "base",
  toToken: string,
  toChain: "solana" | "base"
): Promise<Quote> {
  console.log(
    `[Mayan] Fetching quote: ${amountIn64} USDC  ${fromChain} → ${toChain}`
  );

  const quotes = await fetchQuote({
    amountIn64,
    fromToken,
    toToken,
    fromChain,
    toChain,
    // The Mayan SDK accepts the string literal "auto" for slippageBps at runtime
    // but its public type is `number`.  Cast through unknown to satisfy tsc.
    slippageBps: "auto" as unknown as number,
  });

  if (!quotes || quotes.length === 0) {
    throw new Error(
      `[Mayan] No quotes returned for ${fromChain} → ${toChain}`
    );
  }

  const best = quotes[0];
  console.log(
    `[Mayan] Best quote selected (type=${best.type}, ` +
      `expectedOut=${
        (best as unknown as Record<string, unknown>)?.expectedAmountOut ?? "n/a"
      })`
  );
  return best;
}

// ---------------------------------------------------------------------------
// bridgeToBase — Solana USDC → Base USDC
// ---------------------------------------------------------------------------

/**
 * Bridge USDC from Solana to Base via Mayan.
 *
 * @param amountUsdcUnits USDC amount in base units (6 decimals, e.g. 5_000_000 for $5).
 * @returns               Object containing the Solana tx hash of the bridge initiation.
 */
export async function bridgeToBase(amountUsdcUnits: number): Promise<BridgeResult> {
  const amountStr = usdcUnitsToString(amountUsdcUnits);
  console.log(
    `[Mayan] bridgeToBase: ${amountUsdcUnits} units (${amountStr} USDC)  Solana → Base`
  );

  const baseWallet = getBaseWallet();
  const solanaAddress = v1Keypair.publicKey.toBase58();
  const evmAddress = await baseWallet.getAddress();

  console.log(`[Mayan] Solana sender  : ${solanaAddress}`);
  console.log(`[Mayan] Base recipient : ${evmAddress}`);

  const quote = await fetchBestQuote(
    amountStr,
    USDC_MINT_SOLANA,
    "solana",
    USDC_CONTRACT_BASE,
    "base"
  );

  console.log("[Mayan] Submitting swapFromSolana…");

  // Cast signTransaction to the overloaded SolanaTransactionSigner type.
  const result = await swapFromSolana(
    quote,
    solanaAddress,
    evmAddress,
    null, // referrerAddresses
    signTransaction as SolanaTransactionSigner,
    connection
  );

  const txHash: string = result.signature;
  console.log(`[Mayan] bridgeToBase submitted — Solana tx: ${txHash}`);
  return { txHash };
}

// ---------------------------------------------------------------------------
// bridgeToSolana — Base USDC → Solana USDC
// ---------------------------------------------------------------------------

/**
 * Bridge USDC from Base to Solana via Mayan.
 *
 * Approves the Mayan forwarder contract to spend USDC before initiating the
 * swap, as required for EVM → Solana ERC-20 bridges: without this approval
 * the on-chain `transferFrom` inside the Mayan contract will revert.
 *
 * @param amountUsdcUnits USDC amount in base units (6 decimals, e.g. 5_000_000 for $5).
 * @returns               Object containing the Base tx hash of the bridge initiation.
 */
export async function bridgeToSolana(amountUsdcUnits: number): Promise<BridgeResult> {
  const amountStr = usdcUnitsToString(amountUsdcUnits);
  console.log(
    `[Mayan] bridgeToSolana: ${amountUsdcUnits} units (${amountStr} USDC)  Base → Solana`
  );

  const baseWallet = getBaseWallet();
  const evmAddress = await baseWallet.getAddress();
  const solanaAddress = v1Keypair.publicKey.toBase58();

  console.log(`[Mayan] Base sender      : ${evmAddress}`);
  console.log(`[Mayan] Solana recipient : ${solanaAddress}`);

  // ------------------------------------------------------------------
  // Step 1: Approve the Mayan forwarder to spend USDC on our behalf.
  //
  // EVM → Solana swaps route tokens through the MayanForwarder contract,
  // which calls `transferFrom` on the ERC-20.  Without a prior `approve`
  // that call will revert with an allowance error.
  // ------------------------------------------------------------------
  console.log(
    `[Mayan] Approving Mayan forwarder (${MAYAN_FORWARDER_CONTRACT_BASE}) ` +
      `to spend ${amountUsdcUnits} USDC units…`
  );

  const usdcContract = new ethers.Contract(
    USDC_CONTRACT_BASE,
    ["function approve(address spender, uint256 amount) returns (bool)"],
    baseWallet
  );

  const approveTx = await usdcContract.approve(
    MAYAN_FORWARDER_CONTRACT_BASE,
    BigInt(amountUsdcUnits)
  );
  await approveTx.wait();
  console.log(`[Mayan] USDC approved for Mayan forwarder: ${approveTx.hash}`);

  // ------------------------------------------------------------------
  // Step 2: Fetch the best quote for Base → Solana.
  // ------------------------------------------------------------------
  const quote = await fetchBestQuote(
    amountStr,
    USDC_CONTRACT_BASE,
    "base",
    USDC_MINT_SOLANA,
    "solana"
  );

  // ------------------------------------------------------------------
  // Step 3: Submit the bridge transaction.
  // ------------------------------------------------------------------
  console.log("[Mayan] Submitting swapFromEvm…");

  // The Mayan SDK bundles a CJS copy of ethers; this project uses the ESM
  // entry-point.  Both are identical at runtime — the double cast silences
  // the spurious structural incompatibility that TypeScript detects at the
  // CJS/ESM module boundary.
  const result = await swapFromEvm(
    quote,
    evmAddress,
    solanaAddress,
    null,                                                            // referrerAddresses
    baseWallet as unknown as Parameters<typeof swapFromEvm>[4],     // ethers Signer
    null,                                                            // permit
    null,                                                            // overrides
    null                                                             // payload
  );

  // swapFromEvm returns TransactionResponse | string
  let txHash: string;
  if (typeof result === "string") {
    txHash = result;
  } else {
    // ethers TransactionResponse — same CJS/ESM boundary; cast through unknown.
    txHash = (result as unknown as ethers.TransactionResponse).hash;
  }

  console.log(`[Mayan] bridgeToSolana submitted — Base tx: ${txHash}`);
  return { txHash };
}

// ---------------------------------------------------------------------------
// waitForBridge — poll Mayan explorer until terminal state
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 15_000;       // 15 s between polls
const MAX_WAIT_MS     = 30 * 60_000;   // 30 minute hard ceiling

/**
 * Poll the Mayan explorer API until the swap reaches COMPLETED or REFUNDED.
 *
 * @param txHash Solana signature or EVM tx hash returned by bridgeToBase / bridgeToSolana.
 * @returns The final clientStatus ("COMPLETED" | "REFUNDED").
 * @throws If the bridge has not settled within MAX_WAIT_MS.
 */
export async function waitForBridge(
  txHash: string
): Promise<MayanClientStatus> {
  const url = `${MAYAN_EXPLORER_API}/${txHash}`;
  console.log(`[Mayan] waitForBridge: polling ${url}`);

  const deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    let status: MayanClientStatus | undefined;

    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = (await response.json()) as MayanExplorerResponse;
        status = data.clientStatus;
        console.log(`[Mayan] Bridge status: ${status}`);
      } else {
        console.warn(
          `[Mayan] Explorer returned HTTP ${response.status} — retrying…`
        );
      }
    } catch (err) {
      console.warn(
        `[Mayan] Fetch error — retrying… (${(err as Error).message})`
      );
    }

    if (status === "COMPLETED" || status === "REFUNDED") {
      console.log(`[Mayan] Bridge finalised with status: ${status}`);
      return status;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `[Mayan] waitForBridge timed out after ${
      MAX_WAIT_MS / 60_000
    } minutes for tx: ${txHash}`
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
