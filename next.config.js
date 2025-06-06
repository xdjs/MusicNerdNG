/** @type {import('next').NextConfig} */
const nextConfig = {
  swcMinify: true,
  experimental: {
    swcPlugins: []
  },
  compiler: {
    // Enable all transforms for private class features
    emotion: false
  }
}

module.exports = nextConfig 