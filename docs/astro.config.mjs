// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// https://astro.build/config
export default defineConfig({
	site: 'https://biginformatics.github.io',
	base: '/hive',
	integrations: [
		starlight({
			plugins: [starlightLlmsTxt()],
			title: 'Hive',
			description: 'Agent Communication Platform — messaging, task management, real-time collaboration, and more.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/BigInformatics/hive' }],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'About Hive', slug: 'getting-started/about' },
						{ label: 'Quick Start', slug: 'getting-started/quickstart' },
						{ label: 'Required Technologies', slug: 'getting-started/required-technologies' },
						{ label: 'Configuration', slug: 'getting-started/configuration' },
						{ label: 'Deployment', slug: 'getting-started/deployment' },
						{ label: 'Big Informatics Team', slug: 'getting-started/team' },
					],
				},
				{
					label: 'Features',
					autogenerate: { directory: 'features' },
				},
				{
					label: 'Administration',
					autogenerate: { directory: 'admin' },
				},
				{
					label: 'Reference',
					autogenerate: { directory: 'reference' },
				},
			],
		}),
	],
});
