/**
 * kamino.ts — Kamino lending service.
 *
 * Exposes four operations against the Kamino main market on Solana:
 *   deposit()   — deposit SOL as collateral
 *   borrow()    — borrow USDC against the deposited collateral
 *   repay()     — repay a USDC borrow
 *   withdraw()  — withdraw SOL collateral
 *
 * All SDK calls use @solana/kit v2 types (Address, KeyPairSigner, Rpc).
 * The wallet boundary (getSigner / getRpc) is imported from wallet.ts.
 *
 * SDK note: @kamino-finance/klend-sdk ships BN.js without @types/bn.js in this
 * project.  We suppress the implicit-any via @ts-expect-error at the single
 * import site rather than adding a devDependency.
 */

import BN from "bn.js";

import {
  KaminoMarket,
  KaminoAction,
  VanillaObligation,
  PROGRAM_ID,
  getMedianSlotDurationInMsFromLastEpochs,
} from "@kamino-finance/klend-sdk";

import {
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signAndSendTransactionMessageWithSigners,
  fetchAddressesForLookupTables,
  compressTransactionMessageUsingAddressLookupTables,
} from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";

import { getKaminoSigner, rpc } from "./wallet";
import {
  KAMINO_MAIN_MARKET,
  KAMINO_LUT,
  SOL_MINT,
  USDC_MINT_SOLANA,
  SOL_COLLATERAL_AMOUNT,
  USDC_BORROW_AMOUNT,
} from "../config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SOL has 9 decimal places (lamports). */
const SOL_DECIMALS = 9;
/** USDC has 6 decimal places (micro-USDC). */
const USDC_DECIMALS = 6;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load the Kamino market using a freshly-sampled slot duration.
 * Always reloads so reserve state is current.
 */
async function loadMarket(): Promise<KaminoMarket> {
  // rpc is imported as a module-level constant from wallet.ts
  const marketAddress = address(KAMINO_MAIN_MARKET) as Address;
  const slotDurationMs = await getMedianSlotDurationInMsFromLastEpochs();

  console.log(
    `[Kamino] Loading market ${KAMINO_MAIN_MARKET}` +
      ` (slot duration ≈ ${slotDurationMs.toFixed(1)} ms)…`
  );

  const market = await KaminoMarket.load(rpc, marketAddress, slotDurationMs);
  if (!market) {
    throw new Error(`[Kamino] Failed to load market ${KAMINO_MAIN_MARKET}`);
  }

  console.log(`[Kamino] Market loaded. Reserves: ${market.reserves.size}`);
  return market;
}

/**
 * Convert a human-readable amount (e.g. 20 SOL) to base units as a BN.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toBaseUnits(amount: number, decimals: number): any {
  const factor = Math.pow(10, decimals);
  return new BN(Math.round(amount * factor));
}

/**
 * Build, sign, and send a single transaction containing the given @solana/kit
 * v2 Instructions.  Returns the base-58 transaction signature string.
 */
async function sendInstructions(
  instructions: Instruction[],
  label: string
): Promise<string> {
  if (instructions.length === 0) {
    throw new Error(`[Kamino] No instructions provided for "${label}"`);
  }

  // rpc is imported as a module-level constant from wallet.ts
  const signer = await getKaminoSigner();

  console.log(`[Kamino] Fetching latest blockhash for "${label}"…`);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Fetch the well-known Kamino LUT to compress account references.
  const lutAddr = address(KAMINO_LUT) as Address;
  let addressesByLut: Awaited<ReturnType<typeof fetchAddressesForLookupTables>>;
  try {
    addressesByLut = await fetchAddressesForLookupTables([lutAddr], rpc);
  } catch {
    console.warn("[Kamino] Could not fetch LUT — sending without compression");
    addressesByLut = {};
  }

  const txMessage = await pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        tx
      ),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    (tx) =>
      Object.keys(addressesByLut).length > 0
        ? compressTransactionMessageUsingAddressLookupTables(tx, addressesByLut)
        : tx
  );

  console.log(
    `[Kamino] Signing and sending "${label}" (${instructions.length} instruction(s))…`
  );
  const signatureBytes =
    await signAndSendTransactionMessageWithSigners(txMessage);

  // signAndSendTransactionMessageWithSigners returns a branded Signature string.
  const sig = String(signatureBytes);
  console.log(`[Kamino] "${label}" confirmed. Signature: ${sig}`);
  return sig;
}

/**
 * Execute a KaminoAction by sending up to three sequential transactions:
 *   1. setupIxs    — ATA creation, user-metadata init, etc.
 *   2. lendingIxs  — the core lending instruction
 *   3. cleanupIxs  — WSOL account close, etc.
 *
 * Empty batches are skipped.  Returns all confirmed transaction signatures.
 */
async function executeAction(
  action: KaminoAction,
  label: string
): Promise<string[]> {
  const sigs: string[] = [];

  const batches: Array<{ ixs: Instruction[]; name: string }> = [
    {
      ixs: [...(action.setupIxs   as unknown as Instruction[])],
      name: `${label} [setup]`,
    },
    {
      ixs: [...(action.lendingIxs as unknown as Instruction[])],
      name: `${label} [lending]`,
    },
    {
      ixs: [...(action.cleanupIxs as unknown as Instruction[])],
      name: `${label} [cleanup]`,
    },
  ];

  for (const { ixs, name } of batches) {
    if (ixs.length === 0) {
      console.log(`[Kamino] Skipping empty batch: ${name}`);
      continue;
    }
    const sig = await sendInstructions(ixs, name);
    sigs.push(sig);
  }

  return sigs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deposit SOL as collateral into the Kamino main market.
 *
 * @param amountSol — Amount in SOL (default: SOL_COLLATERAL_AMOUNT from config).
 * @returns Array of confirmed Solana transaction signatures.
 */
export async function deposit(
  amountSol: number = SOL_COLLATERAL_AMOUNT
): Promise<string[]> {
  console.log(
    `\n[Kamino] ── DEPOSIT ${amountSol} SOL ──────────────────────────`
  );

  const market = await loadMarket();
  const signer = await getKaminoSigner();
  const solMint = address(SOL_MINT) as Address;

  if (!market.getReserveByMint(solMint)) {
    throw new Error("[Kamino] No SOL reserve found in market");
  }

  const amountLamports = toBaseUnits(amountSol, SOL_DECIMALS);
  console.log(
    `[Kamino] Depositing ${amountSol} SOL (${amountLamports.toString()} lamports)`
  );

  const action = await KaminoAction.buildDepositTxns(
    market,
    amountLamports,
    solMint,
    signer,
    new VanillaObligation(PROGRAM_ID),
    /* useV2Ixs           */ false,
    /* scopeRefreshConfig */ undefined,
    /* extraComputeBudget */ 300_000,
    /* includeAtaIxs      */ true
  );

  const sigs = await executeAction(action, `deposit(${amountSol} SOL)`);
  console.log(`[Kamino] Deposit complete. Signatures: ${sigs.join(", ")}`);
  return sigs;
}

/**
 * Borrow USDC against the deposited SOL collateral.
 *
 * @param amountUsdc — Amount in USDC (default: USDC_BORROW_AMOUNT from config).
 * @returns Array of confirmed Solana transaction signatures.
 */
export async function borrow(
  amountUsdc: number = USDC_BORROW_AMOUNT
): Promise<string[]> {
  console.log(
    `\n[Kamino] ── BORROW ${amountUsdc} USDC ──────────────────────────`
  );

  const market   = await loadMarket();
  const signer   = await getKaminoSigner();
  const usdcMint = address(USDC_MINT_SOLANA) as Address;

  if (!market.getReserveByMint(usdcMint)) {
    throw new Error("[Kamino] No USDC reserve found in market");
  }

  const amountMicroUsdc = toBaseUnits(amountUsdc, USDC_DECIMALS);
  console.log(
    `[Kamino] Borrowing ${amountUsdc} USDC ` +
      `(${amountMicroUsdc.toString()} micro-USDC)`
  );

  const action = await KaminoAction.buildBorrowTxns(
    market,
    amountMicroUsdc,
    usdcMint,
    signer,
    new VanillaObligation(PROGRAM_ID),
    /* useV2Ixs           */ false,
    /* scopeRefreshConfig */ undefined,
    /* extraComputeBudget */ 300_000,
    /* includeAtaIxs      */ true
  );

  const sigs = await executeAction(action, `borrow(${amountUsdc} USDC)`);
  console.log(`[Kamino] Borrow complete. Signatures: ${sigs.join(", ")}`);
  return sigs;
}

/**
 * Repay a USDC borrow on the Kamino main market.
 *
 * @param amountUsdc — Amount in USDC (default: USDC_BORROW_AMOUNT from config).
 * @returns Array of confirmed Solana transaction signatures.
 */
export async function repay(
  amountUsdc: number = USDC_BORROW_AMOUNT
): Promise<string[]> {
  console.log(
    `\n[Kamino] ── REPAY ${amountUsdc} USDC ───────────────────────────`
  );

  const market   = await loadMarket();
  const signer   = await getKaminoSigner();
  // rpc is imported as a module-level constant from wallet.ts
  const usdcMint = address(USDC_MINT_SOLANA) as Address;

  if (!market.getReserveByMint(usdcMint)) {
    throw new Error("[Kamino] No USDC reserve found in market");
  }

  const amountMicroUsdc = toBaseUnits(amountUsdc, USDC_DECIMALS);
  console.log(
    `[Kamino] Repaying ${amountUsdc} USDC ` +
      `(${amountMicroUsdc.toString()} micro-USDC)`
  );

  // buildRepayTxns requires the current slot as a bigint.
  const currentSlot: bigint = await rpc.getSlot().send();

  const action = await KaminoAction.buildRepayTxns(
    market,
    amountMicroUsdc,
    usdcMint,
    signer,
    new VanillaObligation(PROGRAM_ID),
    /* useV2Ixs           */ false,
    /* scopeRefreshConfig */ undefined,
    /* currentSlot        */ currentSlot,
    /* payer              */ signer,
    /* extraComputeBudget */ 300_000,
    /* includeAtaIxs      */ true
  );

  const sigs = await executeAction(action, `repay(${amountUsdc} USDC)`);
  console.log(`[Kamino] Repay complete. Signatures: ${sigs.join(", ")}`);
  return sigs;
}

/**
 * Withdraw SOL collateral from the Kamino main market.
 *
 * @param amountSol — Amount in SOL (default: SOL_COLLATERAL_AMOUNT from config).
 * @returns Array of confirmed Solana transaction signatures.
 */
export async function withdraw(
  amountSol: number = SOL_COLLATERAL_AMOUNT
): Promise<string[]> {
  console.log(
    `\n[Kamino] ── WITHDRAW ${amountSol} SOL ─────────────────────────`
  );

  const market = await loadMarket();
  const signer = await getKaminoSigner();
  const solMint = address(SOL_MINT) as Address;

  if (!market.getReserveByMint(solMint)) {
    throw new Error("[Kamino] No SOL reserve found in market");
  }

  const amountLamports = toBaseUnits(amountSol, SOL_DECIMALS);
  console.log(
    `[Kamino] Withdrawing ${amountSol} SOL ` +
      `(${amountLamports.toString()} lamports)`
  );

  const action = await KaminoAction.buildWithdrawTxns(
    market,
    amountLamports,
    solMint,
    signer,
    new VanillaObligation(PROGRAM_ID),
    /* useV2Ixs           */ false,
    /* scopeRefreshConfig */ undefined,
    /* extraComputeBudget */ 300_000,
    /* includeAtaIxs      */ true
  );

  const sigs = await executeAction(action, `withdraw(${amountSol} SOL)`);
  console.log(`[Kamino] Withdraw complete. Signatures: ${sigs.join(", ")}`);
  return sigs;
}
