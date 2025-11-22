import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build'
    }),
    alias: {
      $data: 'static/data'
    },
    paths: {
      base: process.env.NODE_ENV === 'production' ? '/price-changes' : '',
    }
  }
};

export default config;
