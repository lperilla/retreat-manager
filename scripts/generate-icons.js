#!/usr/bin/env node
/**
 * Generates the PNG app icons from the SVG logo (run again after changing the logo):
 *   node scripts/generate-icons.js
 *
 * - favicon-32.png        tab icon for browsers without SVG favicons (from favicon.svg)
 * - apple-touch-icon.png  180x180 home-screen icon; iOS rounds the corners itself, so it is
 *                         drawn full-bleed (no transparent corners)
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const IMG = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'infrastructure', 'web', 'public', 'img');

const favicon = await readFile(join(IMG, 'favicon.svg'));
await sharp(favicon, { density: 384 }).resize(32, 32).png({ compressionLevel: 9 }).toFile(join(IMG, 'favicon-32.png'));

const fullBleed = Buffer.from((await readFile(join(IMG, 'logo.svg'), 'utf8')).replace('rx="14"', 'rx="0"'));
await sharp(fullBleed, { density: 384 }).resize(180, 180).flatten({ background: '#334155' }).png({ compressionLevel: 9 }).toFile(join(IMG, 'apple-touch-icon.png'));

// Icon of the desktop app and its installer (electron-builder turns it into the Windows .ico).
const BUILD = join(IMG, '..', '..', '..', '..', '..', 'build');
await mkdir(BUILD, { recursive: true });
await sharp(fullBleed, { density: 384 }).resize(512, 512).png({ compressionLevel: 9 }).toFile(join(BUILD, 'icon.png'));

console.log(`Icons written to ${IMG} and ${BUILD}`);
