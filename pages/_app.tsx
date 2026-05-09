import type { AppProps } from "next/app";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { Toaster } from "react-hot-toast";
import "@solana/wallet-adapter-react-ui/styles.css";
import "../styles/globals.css";

const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
const NETWORK =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as WalletAdapterNetwork) ||
  WalletAdapterNetwork.Devnet;

export default function App({ Component, pageProps }: AppProps) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Component {...pageProps} />
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#0d0d14",
                color: "#e2e8f0",
                border: "1px solid #1e2035",
                borderRadius: "8px",
                fontFamily: "var(--font-mono)",
                fontSize: "13px",
              },
              success: { iconTheme: { primary: "#14F195", secondary: "#0d0d14" } },
              error: { iconTheme: { primary: "#ff4d6d", secondary: "#0d0d14" } },
            }}
          />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
