import "dotenv/config";
import { addresses as mayanAddresses } from "@mayanfinance/swap-sdk";

// Kamino
export const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
export const KAMINO_LUT = "284iwGtA9X9aLy3KsyV8uT2pXLARhYbiSi5SiM2g47M2";

// Token mints (Solana)
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// USDC on Base
export const USDC_CONTRACT_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Mayan forwarder contract on Base (EVM) — sourced from the Mayan SDK's addresses object.
// This is the contract that must be approved to spend ERC-20 tokens before calling swapFromEvm.
export const MAYAN_FORWARDER_CONTRACT_BASE: string = mayanAddresses.MAYAN_FORWARDER_CONTRACT;

// RPC endpoints
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
export const BASE_RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

// Fixed parameters from assignment
export const SOL_COLLATERAL_AMOUNT = 20;   // $20 SOL
export const USDC_BORROW_AMOUNT = 5;       // $5 USDC

// Mayan bridge tracking
export const MAYAN_EXPLORER_API = "https://explorer-api.mayan.finance/v3/swap/trx";
