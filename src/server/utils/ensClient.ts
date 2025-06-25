import { providers } from "ethers";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – ensjs v2 types are not shipped with .d.ts files
import ENS, { getEnsAddress } from "@ensdomains/ensjs";

const alchemyUrl = process.env.ALCHEMY_HTTP_URL;
const infuraUrl = process.env.INFURA_HTTP_URL;

// Build a list of RPC providers in priority order
const rpcProviders: providers.StaticJsonRpcProvider[] = [];

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

// Use FallbackProvider so if the first endpoint returns null/error, ethers automatically tries the next one
export const ensProviderInstance = new providers.FallbackProvider(rpcProviders);

// ensjs v2 exports the constructor as default
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ens = new (ENS as any)({
  provider: ensProviderInstance,
  ensAddress: getEnsAddress("1"),
}); 