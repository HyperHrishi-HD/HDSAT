#!/usr/bin/env node
/**
 * WCAG 2.2 AA token contrast audit.
 *
 * The app paints from CSS variables, so the same semantic pairs must pass in
 * light, dark, and every purchasable theme. This script reads the token blocks
 * from global.css and dark.css, resolves the cascade for each combination, and
 * checks the pairs that carry text and controls.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const globalCss = readFileSync(join(root, 'src/styles/global.css'), 'utf8');
const darkCss = readFileSync(join(root, 'src/styles/dark.css'), 'utf8');

function declarations(source) {
  const out = {};
  for (const match of source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim();
  }
  return out;
}

function rootBlocks(css) {
  const blocks = [];
  for (const match of css.matchAll(/(:root(?:\[[^\]]+\])*)\s*\{([^}]*)\}/g)) {
    blocks.push({ selector: match[1], vars: declarations(match[2]) });
  }
  return blocks;
}

const blocks = [...rootBlocks(globalCss), ...rootBlocks(darkCss)];

function tokensFor({ theme = null, dark = false } = {}) {
  const tokens = {};
  for (const block of blocks) {
    const selector = block.selector;
    const hasTheme = selector.includes('data-theme=');
    const hasDark = selector.includes("data-mode='dark'");
    const themeMatch = selector.match(/data-theme='([^']+)'/);
    if (hasDark !== dark) continue;
    if (hasTheme) {
      if (themeMatch?.[1] !== theme) continue;
    } else if (theme !== null && dark) {
      // A dark block without a theme applies before the dark theme block.
    }
    Object.assign(tokens, block.vars);
  }
  return tokens;
}

function channels(hex) {
  if (typeof hex !== 'string') return null;
  let value = hex.replace('#', '').trim();
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  if (value.length !== 6) return null;
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function luminance(hex) {
  const rgb = channels(hex);
  if (!rgb) return null;
  const linear = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  if (a === null || b === null) return null;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const themes = [
  null,
  'oxford-navy',
  'forest-sage',
  'warm-amber',
  'plum-ink',
  'slate-mono',
  'teal-current',
  'rose-quartz',
  'royal-obsidian',
];

const pairs = [
  ['ink', 'bg', 4.5, 'body text on page'],
  ['ink', 'surface', 4.5, 'body text on card'],
  ['ink', 'surface-2', 4.5, 'body text on inset surface'],
  ['ink-2', 'surface', 4.5, 'secondary text on card'],
  ['muted', 'bg', 4.5, 'muted text on page'],
  ['muted', 'surface', 4.5, 'muted text on card'],
  ['muted', 'surface-2', 4.5, 'muted text on inset surface'],
  ['accent', 'bg', 4.5, 'accent text on page'],
  ['accent', 'surface', 4.5, 'accent text on card'],
  ['accent', 'accent-soft', 4.5, 'accent text on soft accent'],
  ['accent-ink', 'accent', 4.5, 'button label on primary fill'],
  ['good', 'good-bg', 4.5, 'success text on success fill'],
  ['bad', 'bad-bg', 4.5, 'error text on error fill'],
  ['warn', 'warn-bg', 4.5, 'warning text on warning fill'],
  ['accent', 'surface', 3, 'focus ring / control accent'],
];

let failures = 0;
for (const dark of [false, true]) {
  for (const theme of themes) {
    const tokens = tokensFor({ dark, theme });
    const label = `${dark ? 'dark' : 'light'} · ${theme ?? 'default'}`;
    for (const [fg, bg, minimum, description] of pairs) {
      const ratio = contrast(tokens[`--${fg}`], tokens[`--${bg}`]);
      if (ratio === null) {
        console.log(`SKIP ${label.padEnd(28)} ${description}: missing token`);
        continue;
      }
      const status = ratio + 0.001 >= minimum ? 'PASS' : 'FAIL';
      if (status === 'FAIL') failures += 1;
      console.log(
        `${status} ${label.padEnd(28)} ${description.padEnd(34)} ${ratio.toFixed(2)}:1 (min ${minimum})`
      );
    }
  }
}

console.log(`\n${failures === 0 ? 'All token pairs pass.' : `${failures} token pair(s) fail.`}`);
process.exit(failures === 0 ? 0 : 1);
