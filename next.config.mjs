/** @type {import('next').NextConfig} */
const config = {
  experimental: {
    instrumentationHook: true,
    // Ensure the bundled SQLite DB is deployed with serverless functions.
    // Without this, Vercel may omit `data/impact.db` from the function bundle,
    // causing an empty DB at runtime.
    outputFileTracingIncludes: {
      '/api/scores': ['data/impact.db'],
      '/api/collect': ['data/impact.db'],
    },
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
