import { getArtistByProperty } from '@/server/utils/queries/artistQueries';
import { artists } from '@/server/db/schema';

async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {status : 405});
  }

  const {spotifyID} = await req.json();

  if (typeof spotifyID !== 'string') {
    return new Response('Missing or invalid required parameters: spotifyID', {status : 400});
  }

  const artistResp = await getArtistByProperty(artists.spotify, spotifyID);
  if(artistResp.status === 200) return Response.json({ result : artistResp.data });
  
  // Process the parameters (e.g., database lookup, validation, etc.)
  return new Response(artistResp.message, {status : artistResp.status});
}

export { handler as POST }