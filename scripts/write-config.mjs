// Render build step: points the site at the deployed backend by rewriting
// public/js/config.js from the API_BASE_URL environment variable.
import { writeFileSync } from 'node:fs';

const url = process.env.API_BASE_URL?.trim().replace(/\/+$/, '');
if (!url) {
  console.error('API_BASE_URL is not set. Set it to the backend URL, e.g. https://sound-peace-api.onrender.com');
  process.exit(1);
}
new URL(url); // throws on a malformed URL so a typo fails the build

writeFileSync(
  new URL('../public/js/config.js', import.meta.url),
  `export const API_BASE_URL = ${JSON.stringify(url)};\n`,
);
console.log(`public/js/config.js -> ${url}`);
