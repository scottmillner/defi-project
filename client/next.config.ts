import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@kamino-finance/klend-sdk",
    "@kamino-finance/kliquidity-sdk",
    "@kamino-finance/farms-sdk",
    "@kamino-finance/scope-sdk",
    "@mayanfinance/swap-sdk",
    "@solana/web3.js",
    "@solana/kit",
    "@solana/compat",
    "@coral-xyz/anchor",
    "ethers",
    "bn.js",
    "bs58",
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
