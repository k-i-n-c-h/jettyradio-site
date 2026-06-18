// @ts-check
import { defineConfig } from 'astro/config';
import clerk from '@clerk/astro';

import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
  site: 'https://jettyradio.com',
  integrations: [icon(), clerk()],
});