import { getArtistByProperty } from '@/server/utils/queries/artistQueries';
import { artists } from '@/server/db/schema';

export const dynamic = "force-dynamic";

async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {status : 405});
  }

  const {deezerID} = await req.json();

  if (typeof deezerID !== 'string') {
    return new Response('Missing or invalid required parameters: deezerID', {status : 400});
  }

  const artistResp = await getArtistByProperty(artists.deezer, deezerID);
  if(artistResp.status === 200) return Response.json({ result : artistResp.data });

  return new Response(artistResp.message, {status : artistResp.status});
}

export { handler as POST }
