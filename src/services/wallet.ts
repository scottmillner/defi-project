/**
 * wallet.ts — Compatibility boundary between Solana v1 (Mayan) and v2/kit (Kamino) libraries.
 *
 * Exports:
 *  - v1 types  (Keypair, Connection, PublicKey)   → used by Mayan
 *  - v2 types  (TransactionSigner, Address, Rpc)  → used by Kamino
 *  - ethers Wallet                                → used by Base operations
 *
 * NEVER mix @solana/web3.js v1 types with @solana/kit v2 types in the same
 * function call.  Conversion is done here via @solana/compat.
 */

import "dotenv/config";

// ── Solana web3.js v1 (Mayan) ──────────────────────────────────────────────
import {
  Keypair,
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

// ── Solana kit v2 (Kamino) ─────────────────────────────────────────────────
import { createSolanaRpc, createSignerFromKeyPair } from "@solana/kit";
import type {
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
  Address,
  KeyPairSigner,
} from "@solana/kit";
import { fromLegacyKeypair } from "@solana/compat";

// ── Ethers (Base) ──────────────────────────────────────────────────────────
import { ethers } from "ethers";

import { SOLANA_RPC_URL, BASE_RPC_URL } from "../config.js";

// ---------------------------------------------------------------------------
// Build the raw v1 Keypair from the SOLANA_PRIVATE_KEY env var (base58)
// ---------------------------------------------------------------------------
function loadV1Keypair(): Keypair {
  const raw = process.env.SOLANA_PRIVATE_KEY;
  if (!raw) throw new Error("SOLANA_PRIVATE_KEY env var is not set");
  const secretKey = bs58.decode(raw);
  return Keypair.fromSecretKey(secretKey);
}

// ---------------------------------------------------------------------------
// Solana v1 exports (Mayan)
// ---------------------------------------------------------------------------

/** Legacy web3.js v1 Keypair — passed directly to Mayan SDK functions. */
export const v1Keypair: Keypair = loadV1Keypair();

/** Legacy web3.js v1 Connection — passed to Mayan SDK functions. */
export const connection: Connection = new Connection(SOLANA_RPC_URL, "confirmed");

/** Convenience: the wallet's public key as a v1 PublicKey. */
export const v1PublicKey: PublicKey = v1Keypair.publicKey;

/**
 * Mayan-compatible transaction signer.
 * Accepts both legacy Transaction and VersionedTransaction, signs with v1Keypair,
 * and returns the same type — satisfying Mayan's overloaded SolanaTransactionSigner.
 */
export async function signTransaction(trx: Transaction): Promise<Transaction>;
export async function signTransaction(
  trx: VersionedTransaction
): Promise<VersionedTransaction>;
export async function signTransaction(
  trx: Transaction | VersionedTransaction
): Promise<Transaction | VersionedTransaction> {
  if (trx instanceof VersionedTransaction) {
    trx.sign([v1Keypair]);
    return trx;
  }
  trx.sign(v1Keypair);
  return trx;
}

// ---------------------------------------------------------------------------
// Solana v2 / kit exports (Kamino)
// ---------------------------------------------------------------------------

/** Solana kit v2 Rpc client. */
export const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(SOLANA_RPC_URL);

/** The wallet's public key as a kit v2 Address string. */
export const walletAddress: Address = v1Keypair.publicKey.toBase58() as Address;

/**
 * Lazily initialised kit v2 KeyPairSigner derived from the v1 keypair.
 * Called by Kamino service — `getKaminoSigner` is the conventional name used
 * in kamino.ts.
 */
let _kaminoSigner: KeyPairSigner | null = null;

export async function getKaminoSigner(): Promise<TransactionSigner> {
  if (_kaminoSigner) return _kaminoSigner;
  const cryptoKeyPair: CryptoKeyPair = await fromLegacyKeypair(v1Keypair);
  _kaminoSigner = await createSignerFromKeyPair(cryptoKeyPair);
  return _kaminoSigner;
}

// ---------------------------------------------------------------------------
// Ethers / Base exports
// ---------------------------------------------------------------------------

/** Ethers v6 JsonRpcProvider connected to Base mainnet. */
export const baseProvider = new ethers.JsonRpcProvider(BASE_RPC_URL);

/**
 * Returns an ethers v6 Wallet for signing Base transactions.
 * Reads BASE_PRIVATE_KEY (or EVM_PRIVATE_KEY) from the environment.
 */
export function getBaseWallet(): ethers.Wallet {
  const pk = process.env.BASE_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY;
  if (!pk) throw new Error("BASE_PRIVATE_KEY (or EVM_PRIVATE_KEY) env var is not set");
  return new ethers.Wallet(pk, baseProvider);
}

// ---------------------------------------------------------------------------
// @solana/kit v2 aliases — used by kamino.ts
// These wrap the existing singletons in the function-call pattern that
// kamino.ts expects, keeping it decoupled from module-level state.
// ---------------------------------------------------------------------------

/** Returns the @solana/kit v2 KeyPairSigner (alias for getKaminoSigner). */
export async function getSigner(): Promise<TransactionSigner> {
  return getKaminoSigner();
}

/** Returns the @solana/kit v2 Rpc client (the module-level singleton). */
export function getRpc(): Rpc<SolanaRpcApi> {
  return rpc;
}
