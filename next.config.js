/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for Anchor/Solana deps
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      os: false,
      path: false,
      crypto: false,
    };
    return config;
  },
  // Allow Vercel edge functions to read env vars
  env: {
    NEXT_PUBLIC_SOLANA_NETWORK: process.env.NEXT_PUBLIC_SOLANA_NETWORK,
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_ESCROW_PROGRAM_ID: process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID,
    NEXT_PUBLIC_FEE_COLLECTOR: process.env.NEXT_PUBLIC_FEE_COLLECTOR,
  },
};

module.exports = nextConfig;
