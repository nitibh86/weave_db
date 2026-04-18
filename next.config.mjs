/** @type {import('next').NextConfig} */
const config = {
  experimental: {
    instrumentationHook: true,
  },
  // better-sqlite3 is a native module; exclude from webpack bundling for all server targets
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals ?? []), 'better-sqlite3', 'path', 'fs', 'os', 'crypto']
    }
    return config
  },
}

export default config
