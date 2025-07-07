/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Disable strict mode to prevent double socket connections
  experimental: {
    esmExternals: false,
  },
  webpack: (config) => {
    config.externals = [...config.externals, { canvas: 'canvas' }]; // For mediasoup
    return config;
  },
}

module.exports = nextConfig