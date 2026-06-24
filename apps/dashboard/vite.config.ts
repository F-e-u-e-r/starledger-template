import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages project sites are served from /<repo>/. Derive the base path from
// GITHUB_REPOSITORY (owner/repo) so a rename never needs a code change.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : '/';

export default defineConfig({
  base,
  plugins: [react()],
});
