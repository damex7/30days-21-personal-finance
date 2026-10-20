import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Cache Components (the Next.js 16.4 default): nothing is cached unless a
  // function says 'use cache'. Every page here reads the session cookie
  // inside <Suspense>, so the page's frame can still be sent straight away.
  // Nothing personal is ever cached: money is read fresh on every request.
  cacheComponents: true,
  partialPrefetching: true,

  experimental: {
    // Bank statements are uploaded through a Server Action. The default
    // body limit is 1 MB; the importer accepts files up to 1 MB
    // (lib/services/imports.ts), plus room for the multipart wrapping.
    serverActions: { bodySizeLimit: '2mb' },
  },

  // SECURITY HEADERS, sent with every response.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // CLICKJACKING: no other site may show our pages in a frame, where
          // a "Delete my account" button could be hidden under a decoy.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          // Browsers must trust our Content-Type and never "guess" that a
          // CSV export is a script.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Other sites learn only our domain from a link, never the full URL
          // (which may hold report filters).
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // Pages whose URL contains a secret token: send NO Referer at all.
        source: '/(reset-password|verify-email)',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ]
  },

  turbopack: {
    // Pin the project root: there is an unrelated package-lock.json higher up
    // in the home folder that Turbopack would otherwise consider.
    root: __dirname,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default nextConfig
