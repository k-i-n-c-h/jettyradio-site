// @ts-check
import { defineConfig } from 'astro/config';
import clerk from '@clerk/astro';

import icon from 'astro-icon';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://jettyradio.com',
  integrations: [icon(), clerk()],
  vite: {
    plugins: [tailwindcss()]
  }
});