import { providers, utils as ethersUtils, getDefaultProvider, Contract } from "ethers";
import { Alchemy, Network } from "alchemy-sdk";
import ENS from "@ensdomains/ensjs";

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
  console.log("[ensClient] Alchemy SDK initialised with key", alchemyApiKey?.slice(0, 6) + "…");
} else {
  console.log("[ensClient] Alchemy SDK disabled – no API key detected (set ALCHEMY_API_KEY or ALCHEMY_HTTP_URL)");
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
  console.log("[ensClient] Added Alchemy provider");
}

if (infuraUrl) {
  rpcProviders.push(makeProvider(infuraUrl));
  console.log("[ensClient] Added Infura provider");
}

// Always include Cloudflare as a free fallback
rpcProviders.push(makeProvider("https://cloudflare-eth.com"));
console.log("[ensClient] Added Cloudflare provider");

// Additional public RPC (Ankr)
rpcProviders.push(makeProvider("https://rpc.ankr.com/eth"));
console.log("[ensClient] Added Ankr provider");

// We export the raw providers array; calling code handles fallback logic.

/**
 * Resolve an ENS name (e.g. valtik.eth) to a checksummed address using the
 * first RPC provider that succeeds. Returns null if none resolve.
 */
export async function resolveEns(name: string): Promise<string | null> {
  console.log(`[ensClient] resolveEns called for ${name}`);

  // 0) Try ENS.js helper first for each configured provider
  // -----------------------------------------------
  for (const p of rpcProviders) {
    try {
      console.log(`[ensClient] Trying ENS.js resolve via provider ${p.connection?.url ?? 'unknown'}`);
      const ensInstance = new (ENS as any)({ provider: p, ensAddress: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" });
      const ensAddr: string | null = await ensInstance.name(name).getAddress();
      if (ensAddr && ensAddr !== "0x0000000000000000000000000000000000000000") {
        console.log(`[ensClient] ENS resolved via ENS.js`);
        return ethersUtils.getAddress(ensAddr);
      }
    } catch (err) {
      console.warn(`[ensClient] ENS.js lookup threw on provider ${p.connection?.url ?? 'unknown'}:`, err);
      // continue to next fallback
    }
  }

  // 1) Try Alchemy directly if configured
  if (alchemy) {
    console.log('[ensClient] Trying ENS resolve via Alchemy');
    console.log('[ensClient] Alchemy RPC URL', alchemyUrl ?? '(SDK default)');
    try {
      // alchemy-sdk v3 exposes an ethers-like provider at `alchemy.core`
      const addr = await (alchemy as any).core.resolveName?.(name);
      if (addr) {
        console.log(`[ensClient] ENS resolved via Alchemy`);
        return ethersUtils.getAddress(addr);
      } else {
        console.log(`[ensClient] Alchemy returned null for ${name}`);
      }
    } catch (err) {
      console.warn('[ensClient] Alchemy ENS lookup threw:', err);
      /* ignore and continue */
    }
  }

  // 2) Fallback to generic RPC providers (Infura, Cloudflare, etc.)
  for (const p of rpcProviders) {
    console.log(`[ensClient] Trying ENS resolve via provider ${p.connection?.url ?? 'unknown'}`);
    console.log('[ensClient] About to query', p.connection?.url);
    try {
      const addr = await p.resolveName(name);
      if (addr) {
        console.log(`[ensClient] ENS resolved via provider ${p.connection?.url ?? 'unknown'}`);
        return ethersUtils.getAddress(addr); // checksum it
      } else {
        console.log(`[ensClient] Provider ${p.connection?.url ?? 'unknown'} returned null for ${name}`);
      }
    } catch (err) {
      console.warn(`[ensClient] Provider ${p.connection?.url ?? 'unknown'} threw:`, err);
      // ignore and try next provider
    }
  }

  // 3) Final catch-all: ethers default provider (uses multiple free APIs)
  console.log('[ensClient] Trying ENS resolve via ethers default provider');
  try {
    const addr = await getDefaultProvider('mainnet').resolveName(name);
    if (addr) {
      console.log(`[ensClient] ENS resolved via ethers default provider`);
      return ethersUtils.getAddress(addr);
    } else {
      console.log(`[ensClient] Default provider returned null for ${name}`);
    }
  } catch (err) {
    console.warn('[ensClient] Default provider threw:', err);
  }

  // 4) HTTP API fallback (ensideas.com)
  try {
    console.log('[ensClient] Trying ENS resolve via ensideas.com API');
    const apiResp = await fetch(`https://api.ensideas.com/ens/resolve/${name}`);
    if (apiResp.ok) {
      const json = await apiResp.json();
      if (json?.address) {
        console.log('[ensClient] ENS resolved via ensideas.com API');
        return ethersUtils.getAddress(json.address);
      }
      console.log('[ensClient] ensideas.com returned no address for', name);
    } else {
      console.log('[ensClient] ensideas.com HTTP error', apiResp.status);
    }
  } catch (err) {
    console.warn('[ensClient] ensideas.com lookup threw:', err);
  }

  console.warn(`[ensClient] ENS resolution failed for ${name}`);
  return null;
}

/**
 * Validate a wallet identifier provided by the user. Accepts:
 *   • Direct 0x address (checksum optional)
 *   • ENS domain ending with .eth
 * Returns the checksummed 0x address on success, otherwise null.
 */
export async function validateWalletIdentifier(input: string): Promise<string | null> {
  const trimmed = input.trim();

  // Runtime visibility of env values for debugging
  console.log('[ensClient] runtime ALCHEMY_API_KEY', (process.env.ALCHEMY_API_KEY ?? 'undefined').slice(0, 6));
  console.log('[ensClient] runtime ALCHEMY_HTTP_URL', process.env.ALCHEMY_HTTP_URL ?? 'undefined');

  // Looks like an EIP-55 address
  if (ethersUtils.isAddress(trimmed)) {
    return ethersUtils.getAddress(trimmed);
  }

  // Looks like an ENS name
  if (trimmed.toLowerCase().endsWith('.eth')) {
    return await resolveEns(trimmed);
  }

  console.warn(`[ensClient] validateWalletIdentifier: '${input}' is not a valid address or ENS`);
  return null;
}

// Dev-only probe to check outbound ENS resolution via ethers default provider
if (process.env.NODE_ENV !== 'production') {
  (async () => {
    try {
      const { getDefaultProvider } = await import('ethers');
      const probeAddr = await getDefaultProvider('mainnet', {
        alchemy: process.env.ALCHEMY_API_KEY ?? undefined,
      }).resolveName('vitalik.eth');
      console.log('[probe] direct defaultProvider result', probeAddr);
    } catch (err) {
      console.warn('[probe] defaultProvider ENS probe threw:', err);
    }
  })();
} 