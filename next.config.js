/** @type {import('next/dist/server/config-shared').NextConfig} */
const nextConfig = {
  images: {
    domains: [
      'utfs.io',
      'i.scdn.co',
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
        port: '',
        pathname: '**',
      },
    ],
  },
};

module.exports = nextConfig; 