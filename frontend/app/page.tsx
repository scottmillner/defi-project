"use client";

import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

type ActionResult = {
  error?: string;
  [key: string]: unknown;
};

export default function Home() {
  const { login, logout, authenticated, ready } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { wallets: evmWallets } = useWallets();

  const [loading, setLoading] = useState<"open" | "close" | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const solanaAddress = solanaWallets[0]?.address;
  const evmAddress = evmWallets[0]?.address;

  async function handleAction(action: "open" | "close") {
    setLoading(action);
    setResult(null);
    try {
      const res = await fetch(`/api/${action}`, { method: "POST" });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(null);
    }
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <h1 className="text-3xl font-bold">DeFi Position Manager</h1>
        <p className="text-gray-400 max-w-md text-center">
          Deposit SOL as collateral on Kamino, borrow USDC, and bridge to Base
          via Mayan.
        </p>
        <button
          onClick={login}
          className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors"
        >
          Login with Privy
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">DeFi Position Manager</h1>
          <button
            onClick={logout}
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Logout
          </button>
        </div>

        <div className="space-y-4 mb-8">
          <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
            <p className="text-sm text-gray-400 mb-1">Solana Wallet</p>
            <p className="font-mono text-sm truncate">
              {solanaAddress ?? "No wallet connected"}
            </p>
          </div>
          <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
            <p className="text-sm text-gray-400 mb-1">Base Wallet</p>
            <p className="font-mono text-sm truncate">
              {evmAddress ?? "No wallet connected"}
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-8">
          <p className="text-sm text-gray-400">
            Collateral: 20 SOL | Borrow: 5 USDC | Bridge: Solana &rarr; Base
          </p>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => handleAction("open")}
              disabled={loading !== null}
              className="px-4 py-3 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
            >
              {loading === "open" ? "Opening..." : "Open Position"}
            </button>
            <button
              onClick={() => handleAction("close")}
              disabled={loading !== null}
              className="px-4 py-3 bg-red-700 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
            >
              {loading === "close" ? "Closing..." : "Close Position"}
            </button>
          </div>
        </div>

        {result && (
          <div
            className={`p-4 rounded-lg border ${
              result.error
                ? "bg-red-950 border-red-800"
                : "bg-green-950 border-green-800"
            }`}
          >
            <p className="text-sm font-medium mb-2">
              {result.error ? "Error" : "Success"}
            </p>
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
