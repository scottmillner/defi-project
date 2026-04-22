"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { base } from "viem/chains";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#676FFF",
        },
        loginMethods: ["email", "wallet", "google"],
        defaultChain: base,
        supportedChains: [base],
        embeddedWallets: {
          createOnLogin: "all-users",
        },
        solanaClusters: [
          {
            name: "mainnet-beta",
            rpcUrl:
              process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
              "https://api.mainnet-beta.solana.com",
          },
        ],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
