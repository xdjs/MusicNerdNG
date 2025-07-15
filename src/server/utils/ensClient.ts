import { providers } from "ethers";
import { Alchemy, Network } from "alchemy-sdk";

function deriveKeyFromUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    const match = u.match(/\/v2\/([a-zA-Z0-9]+)(?:\/?|$)/);
    if (match && match[1]) return match[1];
    // fallback to last path segment
    const last = u.split("/").pop();
    return last && last.length >= 32 ? last : undefined;
  } catch {
    return undefined;
  }
}

let rawKey = process.env.ALCHEMY_API_KEY;
if (rawKey && rawKey.startsWith("http")) {
  // Someone put the full URL in the API_KEY var – extract just the key.
  rawKey = deriveKeyFromUrl(rawKey);
}

const alchemyApiKey = rawKey || deriveKeyFromUrl(process.env.ALCHEMY_HTTP_URL);

export const alchemy: Alchemy | null = alchemyApiKey
  ? new Alchemy({ apiKey: alchemyApiKey, network: Network.ETH_MAINNET })
  : null;

if (alchemy) {
  console.debug("[ensClient] Alchemy SDK initialised with key", alchemyApiKey?.slice(0, 6) + "…");
} else {
  console.debug("[ensClient] Alchemy SDK disabled – no API key detected (set ALCHEMY_API_KEY or ALCHEMY_HTTP_URL)");
}

const alchemyUrl = process.env.ALCHEMY_HTTP_URL;
const infuraUrl = process.env.INFURA_HTTP_URL;

// Build a list of RPC providers in priority order
export const rpcProviders: providers.StaticJsonRpcProvider[] = [];

function makeProvider(url: string) {
  return new providers.StaticJsonRpcProvider(url, {
    name: "homestead",
    chainId: 1,
    ensAddress: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
  });
}

if (alchemyUrl) {
  rpcProviders.push(makeProvider(alchemyUrl));
  console.debug("[ensClient] Added Alchemy provider");
}

if (infuraUrl) {
  rpcProviders.push(makeProvider(infuraUrl));
  console.debug("[ensClient] Added Infura provider");
}

// Always include Cloudflare as a free fallback
rpcProviders.push(makeProvider("https://cloudflare-eth.com"));
console.debug("[ensClient] Added Cloudflare provider");

// We export the raw providers array; calling code handles fallback logic. 