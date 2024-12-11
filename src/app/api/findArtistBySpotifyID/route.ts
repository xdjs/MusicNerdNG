import { NextApiRequest, NextApiResponse } from 'next';
import { getArtistBySpotifyId } from '@/server/utils/queriesTS';

export const config = {
  api: {
    bodyParser: true,  // Make sure bodyParser is enabled or properly configured
  },
};

async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {status : 405});
  }

  const {spotifyID} = await req.json();

  if (typeof spotifyID !== 'string') {
    return new Response('Missing or invalid required parameters: spotifyID', {status : 400});
  }
  const artistResp = await getArtistBySpotifyId(spotifyID);
  if(artistResp.status === 200) return Response.json({ result : artistResp.data })
  // Process the parameters (e.g., database lookup, validation, etc.)
  return new Response(artistResp.message, {status : artistResp.status});
}

export { handler as POST }