import { defineConfig } from 'vite';

// Public address of the deployed site (e.g. https://<user>.github.io/<repo>/). Social previews need absolute
// og:url / og:image URLs, so they are only emitted when this is set: SITE_URL=https://… npm run build
const siteUrl = process.env.SITE_URL?.replace(/\/?$/, '/');

// Cloudflare Web Analytics site token (cookie-free page-view counts). Only production builds that set it get the
// beacon, so local dev and builds without the variable send nothing anywhere: CF_BEACON_TOKEN=… npm run build
const beaconToken = process.env.CF_BEACON_TOKEN?.trim();
if (beaconToken && !/^[0-9a-f]{32}$/i.test(beaconToken)) {
  throw new Error('CF_BEACON_TOKEN should be the 32-character hex token from Cloudflare Web Analytics');
}

export default defineConfig({
  // Relative asset URLs, so the built site works from any folder or sub-path
  // (e.g. https://<user>.github.io/<repo>/) without knowing the path at build time.
  base: './',
  plugins: [{
    name: 'social-meta',
    transformIndexHtml: () => (siteUrl ? [
      ['meta', { property: 'og:url', content: siteUrl }],
      ['meta', { property: 'og:image', content: `${siteUrl}og-image.png` }],
      ['meta', { property: 'og:image:width', content: '1200' }],
      ['meta', { property: 'og:image:height', content: '630' }],
      ['meta', { property: 'og:image:alt', content: 'CityLens showing a furnished CityGML house cut open by a section plane' }],
      ['meta', { name: 'twitter:image', content: `${siteUrl}og-image.png` }],
    ] : []).map(([tag, attrs]) => ({ tag, attrs, injectTo: 'head' })),
  }, {
    name: 'cloudflare-web-analytics',
    apply: 'build',
    transformIndexHtml: () => (beaconToken ? [{
      tag: 'script',
      attrs: { defer: true, src: 'https://static.cloudflareinsights.com/beacon.min.js', 'data-cf-beacon': JSON.stringify({ token: beaconToken }) },
      injectTo: 'body',
    }] : []),
  }],
});
