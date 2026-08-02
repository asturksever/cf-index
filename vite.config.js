import { defineConfig } from 'vite';

// GitHub Pages serves the site at /cf-index/; CI sets GH_PAGES_BASE.
export default defineConfig({
  base: process.env.GH_PAGES_BASE ?? '/',
});
