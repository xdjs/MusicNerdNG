import { getArtistByNameApiResp, getArtistByWalletOrEns } from '@/server/utils/queries/artistQueries';

async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {status : 405});
  }

  const {name, ethAddress} = await req.json();

  if (typeof name !== 'string' && typeof ethAddress !== 'string') {
    return new Response('Missing or invalid required parameters: name or ethAddress', {status : 400});
  }
  
  if(ethAddress) {
    const artistResp = await getArtistByWalletOrEns(ethAddress);
    if(artistResp.status === 200) return Response.json({ result : artistResp.data?.x});
    return new Response(artistResp.message, {status : artistResp.status});
  }

  if(name) {
    const artistResp = await getArtistByNameApiResp(name);
    if(artistResp.status === 200) return Response.json({ result : artistResp.data?.x });
    return new Response(artistResp.message, {status : artistResp.status});
  }
  
  return new Response("Missing or invalid required parameters: name or ethAddress", {status : 400});
}

export { handler as POST }