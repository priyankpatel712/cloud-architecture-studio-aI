import type { NextConfig } from "next";

/**
 * Security response headers (security review — general hardening).
 *
 * CSP notes: the app is fully same-origin — every API call, icon, and font is
 * served from `self`; LLM/MCP/cloud calls all happen server-side — so a tight
 * `connect-src 'self'` is safe. `'unsafe-inline'` on script/style is still
 * required because Next's hydration bootstrap and React/xyflow inline styles
 * are not nonce-tagged; `'unsafe-eval'` is limited to development (HMR). Tighten
 * to a nonce-based policy (via proxy.ts) when time allows.
 */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  `upgrade-insecure-requests`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Clickjacking: frame-ancestors above is the modern control; X-Frame-Options
  // covers older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // Ignored by browsers over plain HTTP/localhost; enforces HTTPS in production.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
