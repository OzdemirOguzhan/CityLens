import { defineConfig } from 'vite';

// Public address of the deployed site (e.g. https://<user>.github.io/<repo>/). Social previews need absolute
// og:url / og:image URLs, so they are only emitted when this is set: SITE_URL=https://… npm run build
const siteUrl = process.env.SITE_URL?.replace(/\/?$/, '/');

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
  }],
});
