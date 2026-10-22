import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so the built site works from any folder or sub-path
  // (e.g. https://<user>.github.io/<repo>/) without knowing the path at build time.
  base: './',
});
