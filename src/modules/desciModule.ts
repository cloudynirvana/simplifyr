/**
 * DeSci + Hackathon module
 * Pins research hypotheses to IPFS via nft.storage.
 * Set NFT_STORAGE_API_KEY in .env.local (free tier works).
 */

export interface HypothesisMetadata {
  title: string;
  abstract: string;
  authors: string[];
  keywords: string[];
  fundingTarget: number;   // in SOL
  escrowId: string;
  walletAddress: string;
  timestamp: string;
}

export interface PinnedHypothesis {
  cid: string;
  ipfsUrl: string;
  gatewayUrl: string;
  metadata: HypothesisMetadata;
}

/**
 * Pins a DeSci grant hypothesis to IPFS.
 * Returns the CID which should be stored in the escrow description field.
 */
export async function pinHypothesisToIPFS(
  hypothesis: HypothesisMetadata
): Promise<PinnedHypothesis> {
  const apiKey = process.env.NFT_STORAGE_API_KEY;
  if (!apiKey) throw new Error("NFT_STORAGE_API_KEY not set in environment");

  const body = JSON.stringify({
    name: hypothesis.title,
    description: hypothesis.abstract,
    attributes: [
      { trait_type: "Authors", value: hypothesis.authors.join(", ") },
      { trait_type: "Keywords", value: hypothesis.keywords.join(", ") },
      { trait_type: "FundingTarget", value: `${hypothesis.fundingTarget} SOL` },
      { trait_type: "EscrowId", value: hypothesis.escrowId },
      { trait_type: "Submitter", value: hypothesis.walletAddress },
      { trait_type: "Timestamp", value: hypothesis.timestamp },
    ],
    properties: {
      category: "DeSciGrant",
      fullMetadata: hypothesis,
    },
  });

  const res = await fetch("https://api.nft.storage/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`nft.storage upload failed: ${err}`);
  }

  const data = await res.json();
  const cid: string = data.value.cid;

  return {
    cid,
    ipfsUrl: `ipfs://${cid}`,
    gatewayUrl: `https://nftstorage.link/ipfs/${cid}`,
    metadata: hypothesis,
  };
}

/**
 * Validates that a CID exists and is accessible before creating escrow.
 */
export async function validateIPFSCID(cid: string): Promise<boolean> {
  try {
    const res = await fetch(`https://nftstorage.link/ipfs/${cid}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Generates a unique escrow ID from the CID (first 8 bytes of hash).
 * Deterministic so the same hypothesis always maps to the same escrow.
 */
export function cidToEscrowId(cid: string): bigint {
  const bytes = Buffer.from(cid.replace(/^Qm/, ""), "base64");
  if (bytes.length >= 8) {
    return bytes.readBigUInt64BE(0);
  }
  // Fallback: hash the cid string
  let hash = 0n;
  for (const char of cid) {
    hash = (hash * 31n + BigInt(char.charCodeAt(0))) & 0xffffffffffffffffn;
  }
  return hash;
}
