import { NextRequest } from 'next/server';
import { getAllLinks } from '@/server/utils/queries/artistQueries';

export async function GET(req: NextRequest) {
  const allLinks = await getAllLinks();
  // Only include platforms that are not 'ens' or 'wallets'
  const regexes = allLinks
    .filter(link => link.siteName !== 'ens' && link.siteName !== 'wallets')
    .map(link => ({ siteName: link.siteName, regex: link.regex }));
  return new Response(JSON.stringify(regexes), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
} 