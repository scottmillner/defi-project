/**
 * pipeline.ts — End-to-end orchestration of the DeFi position lifecycle.
 *
 * openPosition:
 *   1. Deposit SOL collateral on Kamino (Solana)
 *   2. Borrow USDC from Kamino (Solana)
 *   3. Bridge USDC Solana → Base via Mayan, then wait for completion
 *
 * closePosition:
 *   1. Bridge USDC Base → Solana via Mayan, then wait for completion
 *   2. Repay borrowed USDC on Kamino (Solana)
 *   3. Withdraw SOL collateral from Kamino (Solana)
 *
 * All amounts use the fixed constants from config.ts unless overrides are
 * provided.  Kamino amounts in base-units are delegated to the kamino service.
 */

import {
  SOL_COLLATERAL_USD,
  USDC_BORROW_AMOUNT,
} from "../config";

import { deposit, borrow, repay, withdraw } from "./kamino";
import { bridgeToBase, bridgeToSolana, waitForBridge } from "./mayan";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the current SOL price from CoinGecko and convert a USD amount to SOL.
 */
async function usdToSol(usd: number): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
  );
  if (!res.ok) throw new Error(`CoinGecko request failed: ${res.status}`);
  const data = (await res.json()) as { solana: { usd: number } };
  const price = data.solana.usd;
  const sol = usd / price;
  console.log(`[pipeline] SOL price: $${price} → $${usd} = ${sol.toFixed(6)} SOL`);
  return parseFloat(sol.toFixed(6));
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenPositionResult {
  /** Kamino deposit transaction signatures */
  depositSignatures: string[];
  /** Kamino borrow transaction signatures */
  borrowSignatures: string[];
  /** Mayan bridge tx hash (Solana → Base) */
  bridgeTxHash: string;
  /** Final bridge status */
  bridgeStatus: "COMPLETED" | "REFUNDED";
}

export interface ClosePositionResult {
  /** Mayan bridge tx hash (Base → Solana) */
  bridgeTxHash: string;
  /** Final bridge status */
  bridgeStatus: "COMPLETED" | "REFUNDED";
  /** Kamino repay transaction signatures */
  repaySignatures: string[];
  /** Kamino withdraw transaction signatures */
  withdrawSignatures: string[];
}

export interface PositionAmounts {
  /** SOL collateral in whole SOL (default: SOL_COLLATERAL_AMOUNT from config) */
  solAmount?: number;
  /** USDC in whole USDC (default: USDC_BORROW_AMOUNT from config) */
  usdcAmount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** USDC has 6 decimal places. */
const USDC_DECIMALS = 1_000_000;

/**
 * Convert whole USDC to base units (6 decimals) for Mayan's amountIn64.
 * Kamino's service already accepts whole amounts internally.
 */
function usdcToUnits(wholeUsdc: number): number {
  return Math.round(wholeUsdc * USDC_DECIMALS);
}

// ─────────────────────────────────────────────────────────────────────────────
// openPosition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a DeFi position:
 *   Deposit SOL → Borrow USDC → Bridge USDC to Base → Wait for bridge
 *
 * @param amounts  Optional overrides for SOL collateral and USDC borrow amounts.
 * @returns        Signatures and hashes for every step, plus the final bridge status.
 */
export async function openPosition(
  amounts: PositionAmounts = {}
): Promise<OpenPositionResult> {
  const solAmount  = amounts.solAmount  ?? await usdToSol(SOL_COLLATERAL_USD);
  const usdcAmount = amounts.usdcAmount ?? USDC_BORROW_AMOUNT;
  const usdcUnits  = usdcToUnits(usdcAmount);

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("[pipeline] openPosition started");
  console.log(`[pipeline]   SOL collateral : ${solAmount} SOL ($${SOL_COLLATERAL_USD})`);
  console.log(`[pipeline]   USDC borrow    : ${usdcAmount} USDC (${usdcUnits} base units)`);
  console.log("═══════════════════════════════════════════════════════════════");

  // ── Step 1: Deposit SOL collateral on Kamino ─────────────────────────────
  console.log("\n[pipeline] Step 1/3 — Depositing SOL collateral on Kamino …");
  const depositSignatures = await deposit(solAmount);
  console.log(`[pipeline] ✔ Deposit complete: ${depositSignatures.join(", ")}`);

  // ── Step 2: Borrow USDC from Kamino ──────────────────────────────────────
  console.log("\n[pipeline] Step 2/3 — Borrowing USDC from Kamino …");
  const borrowSignatures = await borrow(usdcAmount);
  console.log(`[pipeline] ✔ Borrow complete: ${borrowSignatures.join(", ")}`);

  // ── Step 3: Bridge USDC from Solana to Base ───────────────────────────────
  console.log("\n[pipeline] Step 3/3 — Bridging USDC from Solana → Base via Mayan …");
  const { txHash: bridgeTxHash } = await bridgeToBase(usdcUnits);
  console.log(`[pipeline] ✔ Bridge submitted: ${bridgeTxHash}`);

  console.log("\n[pipeline] Waiting for Mayan bridge to settle …");
  const bridgeStatus = (await waitForBridge(bridgeTxHash)) as "COMPLETED" | "REFUNDED";
  console.log(`[pipeline] ✔ Bridge ${bridgeStatus}: ${bridgeTxHash}`);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("[pipeline] openPosition COMPLETE");
  console.log(`[pipeline]   deposit  : ${depositSignatures.join(", ")}`);
  console.log(`[pipeline]   borrow   : ${borrowSignatures.join(", ")}`);
  console.log(`[pipeline]   bridge   : ${bridgeTxHash} (${bridgeStatus})`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  return {
    depositSignatures,
    borrowSignatures,
    bridgeTxHash,
    bridgeStatus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// closePosition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Close a DeFi position:
 *   Bridge USDC Base → Solana → Wait for bridge → Repay USDC → Withdraw SOL
 *
 * @param amounts  Optional overrides for USDC repay and SOL withdraw amounts.
 * @returns        Signatures and hashes for every step, plus the final bridge status.
 * @throws If the bridge is REFUNDED — aborting repay/withdraw to prevent
 *         a situation where no funds arrived but the obligation is cleared.
 */
export async function closePosition(
  amounts: PositionAmounts = {}
): Promise<ClosePositionResult> {
  const solAmount  = amounts.solAmount  ?? await usdToSol(SOL_COLLATERAL_USD);
  const usdcAmount = amounts.usdcAmount ?? USDC_BORROW_AMOUNT;
  const usdcUnits  = usdcToUnits(usdcAmount);

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("[pipeline] closePosition started");
  console.log(`[pipeline]   USDC repay   : ${usdcAmount} USDC (${usdcUnits} base units)`);
  console.log(`[pipeline]   SOL withdraw : ${solAmount} SOL ($${SOL_COLLATERAL_USD})`);
  console.log("═══════════════════════════════════════════════════════════════");

  // ── Step 1: Bridge USDC from Base back to Solana ─────────────────────────
  console.log("\n[pipeline] Step 1/3 — Bridging USDC from Base → Solana via Mayan …");
  const { txHash: bridgeTxHash } = await bridgeToSolana(usdcUnits);
  console.log(`[pipeline] ✔ Bridge submitted: ${bridgeTxHash}`);

  console.log("\n[pipeline] Waiting for Mayan bridge to settle …");
  const bridgeStatus = (await waitForBridge(bridgeTxHash)) as "COMPLETED" | "REFUNDED";
  console.log(`[pipeline] ✔ Bridge ${bridgeStatus}: ${bridgeTxHash}`);

  if (bridgeStatus === "REFUNDED") {
    throw new Error(
      `[pipeline] Mayan bridge was REFUNDED (tx: ${bridgeTxHash}). ` +
        "USDC did not arrive on Solana — aborting repay/withdraw to avoid " +
        "leaving the obligation under-collateralised."
    );
  }

  // ── Step 2: Repay USDC on Kamino ─────────────────────────────────────────
  console.log("\n[pipeline] Step 2/3 — Repaying USDC on Kamino …");
  const repaySignatures = await repay(usdcAmount);
  console.log(`[pipeline] ✔ Repay complete: ${repaySignatures.join(", ")}`);

  // ── Step 3: Withdraw SOL collateral from Kamino ───────────────────────────
  console.log("\n[pipeline] Step 3/3 — Withdrawing SOL collateral from Kamino …");
  const withdrawSignatures = await withdraw(solAmount);
  console.log(`[pipeline] ✔ Withdraw complete: ${withdrawSignatures.join(", ")}`);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("[pipeline] closePosition COMPLETE");
  console.log(`[pipeline]   bridge   : ${bridgeTxHash} (${bridgeStatus})`);
  console.log(`[pipeline]   repay    : ${repaySignatures.join(", ")}`);
  console.log(`[pipeline]   withdraw : ${withdrawSignatures.join(", ")}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  return {
    bridgeTxHash,
    bridgeStatus,
    repaySignatures,
    withdrawSignatures,
  };
}
