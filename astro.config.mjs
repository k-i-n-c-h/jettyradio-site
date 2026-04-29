// @ts-check
import { defineConfig } from 'astro/config';
import icon from 'astro-icon';
import netlify from '@astrojs/netlify';
import clerk from '@clerk/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://jettyradio.com',
  output: 'static',
  adapter: netlify(),
  integrations: [icon(), clerk()],
});