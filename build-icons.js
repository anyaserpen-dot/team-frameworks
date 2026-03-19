#!/usr/bin/env node
/**
 * build-icons.js
 * Reads SVG icons from local npm packages and embeds ICON_PATHS into favicon-studio.html.
 * Run: node build-icons.js
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HTML_FILE = path.join(__dirname, 'favicon-studio.html');
const NM        = path.join(__dirname, 'node_modules');

// ─── 1. Install packages ────────────────────────────────────────────────────
const PACKAGES = [
  'lucide-static',
  '@tabler/icons',
  '@phosphor-icons/core',
  'bootstrap-icons',
];

console.log('📦 Installing icon packages…');
execSync(`npm install --save-dev ${PACKAGES.join(' ')}`, { stdio: 'inherit', cwd: __dirname });
console.log('');

// ─── 2. Extract ICON_MAP from HTML ──────────────────────────────────────────
console.log('📖 Reading ICON_MAP from favicon-studio.html…');
const html = fs.readFileSync(HTML_FILE, 'utf8');

const mapStart = html.indexOf('const ICON_MAP = [');
if (mapStart === -1) throw new Error('ICON_MAP not found in HTML');

// Walk brackets to find the end of the array literal
let depth = 0, mapEnd = -1;
for (let i = mapStart + 'const ICON_MAP = '.length; i < html.length; i++) {
  if (html[i] === '[') depth++;
  else if (html[i] === ']') { depth--; if (depth === 0) { mapEnd = i + 1; break; } }
}
if (mapEnd === -1) throw new Error('Could not find end of ICON_MAP');

// Safely eval the array literal (our own code, no user input)
const iconMapSrc = html.slice(mapStart + 'const ICON_MAP = '.length, mapEnd);
const ICON_MAP = eval(iconMapSrc); // eslint-disable-line no-eval
console.log(`  Found ${ICON_MAP.length} categories\n`);

// ─── 3. Helpers ─────────────────────────────────────────────────────────────

// PascalCase → kebab-case (for Phosphor filenames)
function toKebab(name) {
  return name.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '-' : '') + c.toLowerCase());
}

// Resolve SVG file path for each library
function svgPath(ico) {
  const { name, lib, weight } = ico;
  switch (lib) {
    case 'lucide':
      return path.join(NM, 'lucide-static', 'icons', `${name}.svg`);
    case 'tabler':
      return path.join(NM, '@tabler', 'icons', 'icons', 'outline', `${name}.svg`);
    case 'phosphor': {
      const w   = weight || 'regular';
      const k   = toKebab(name);
      const file = w === 'regular' ? `${k}.svg` : `${k}-${w}.svg`;
      return path.join(NM, '@phosphor-icons', 'core', 'assets', w, file);
    }
    case 'bootstrap':
      return path.join(NM, 'bootstrap-icons', 'icons', `${name}.svg`);
    default:
      return null;
  }
}

// Extract inner SVG content, strip fill/stroke attrs, remove spacer rects
function extractPaths(svgText, isStroke, srcSize) {
  let inner = svgText
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<svg[^>]*>/g, '')
    .replace(/<\/svg>/g, '')
    .trim();

  // Remove invisible spacer / background elements before stripping attrs
  inner = inner
    .replace(/<[a-z]+[^>]*\bstroke="none"[^>]*\bfill="none"[^>]*\/>/gi, '')
    .replace(/<[a-z]+[^>]*\bfill="none"[^>]*\bstroke="none"[^>]*\/>/gi, '')
    .replace(/<rect[^>]*(?:width="(?:24|256)"[^>]*height="(?:24|256)"|height="(?:24|256)"[^>]*width="(?:24|256)")[^>]*\/>/gi, '');

  // Strip presentation attrs (will be set by CSS per favicon)
  inner = inner
    .replace(/\s*fill="[^"]*"/g, '')
    .replace(/\s*stroke="[^"]*"/g, '')
    .replace(/\s*stroke-width="[^"]*"/g, '');

  inner = inner.trim();
  if (!inner) return null;
  return { paths: inner, stroke: isStroke, srcSize };
}

// ─── 4. Build ICON_PATHS ────────────────────────────────────────────────────
console.log('🔍 Reading SVG files…\n');

const ICON_PATHS = {};
const missing    = [];
const found      = [];

for (const entry of ICON_MAP) {
  entry.icons.forEach((ico, idx) => {
    if (!ico.lib) return; // sprite icons (no lib) are handled separately

    const key      = `${entry.category}_${idx}`;
    const filePath = svgPath(ico);

    if (!filePath || !fs.existsSync(filePath)) {
      missing.push({ key, lib: ico.lib, name: ico.name, weight: ico.weight });
      return;
    }

    const svgText  = fs.readFileSync(filePath, 'utf8');
    const isStroke = ico.lib === 'lucide' || ico.lib === 'tabler';
    const srcSize  = ico.lib === 'phosphor' ? 256 : ico.lib === 'bootstrap' ? 16 : 24;
    const result   = extractPaths(svgText, isStroke, srcSize);

    if (!result) {
      missing.push({ key, lib: ico.lib, name: ico.name, weight: ico.weight, reason: 'empty paths' });
      return;
    }

    ICON_PATHS[key] = result;
    found.push(key);
  });
}

// ─── 5. Report ──────────────────────────────────────────────────────────────
console.log(`✅ Built: ${found.length} icons`);

if (missing.length) {
  console.log(`\n⚠️  Missing (${missing.length}):`);
  for (const m of missing) {
    console.log(`   ${m.lib}:${m.name}${m.weight ? ':' + m.weight : ''} → ${m.key}${m.reason ? ' ('+m.reason+')' : ''}`);
  }
}
console.log('');

// ─── 6. Serialize ICON_PATHS as compact JSON ─────────────────────────────────
// Paths can contain backticks, so use JSON.stringify for safety
const iconPathsJson = JSON.stringify(ICON_PATHS, null, 0);

// ─── 7. Inject into HTML ─────────────────────────────────────────────────────
console.log('💉 Injecting ICON_PATHS into favicon-studio.html…');

// Marker: inject const ICON_PATHS right before const ICON_MAP
// Remove previous injection if present
let newHtml = html.replace(/\/\/ ─+ ICON_PATHS \(auto-generated[^]*?\/\/ ─+ end ICON_PATHS[^\n]*\n/, '');

const injection =
  `// ── ICON_PATHS (auto-generated by build-icons.js — do not edit manually) ──\n` +
  `const ICON_PATHS = ${iconPathsJson};\n` +
  `// ── end ICON_PATHS ──\n`;

newHtml = newHtml.replace('const ICON_MAP = [', injection + 'const ICON_MAP = [');

// ─── 8. Replace loadIconsSprite with fast static version ────────────────────
const OLD_LOADER_START = 'async function loadIconsSprite()';
const OLD_LOADER_END   = '\nfunction tick(';

const loaderStart = newHtml.indexOf(OLD_LOADER_START);
const loaderEnd   = newHtml.indexOf(OLD_LOADER_END, loaderStart);
if (loaderStart === -1 || loaderEnd === -1) {
  throw new Error('Could not find loadIconsSprite in HTML');
}

const NEW_LOADER = `\
async function loadIconsSprite() {
  const bar = document.getElementById('prog-bar');
  const lbl = document.getElementById('prog-label');
  try {
    lbl.textContent = 'Завантаження іконок…';
    bar.style.width = '30%';
    await tick();

    // ── Phase 1: sprite (icons.svg via getBBox) ──────────────────────────────
    const spriteDiv = document.getElementById('icons-sprite');
    if (spriteDiv) {
      spriteDiv.style.display = 'block';
      const svgEl = spriteDiv.querySelector('svg');
      if (svgEl) {
        for (const entry of ICON_MAP) {
          entry.icons.forEach((ico, idx) => {
            if (ico.lib) return; // CDN icons handled below
            const el = svgEl.querySelector(\`[id="\${ico.name.replace(/\\\\/g,'\\\\\\\\').replace(/"/g,'\\\\"')}"]\`);
            if (!el) return;
            const bbox = el.getBBox();
            if (!bbox.width || !bbox.height) return;
            const inner = el.innerHTML
              .replace(/\\s*fill="[^"]*"/g, '')
              .replace(/\\s*stroke="[^"]*"/g, '');
            const scale = Math.min(16 / bbox.width, 16 / bbox.height);
            const cx = ((16 - bbox.width  * scale) / 2 - bbox.x * scale).toFixed(2);
            const cy = ((16 - bbox.height * scale) / 2 - bbox.y * scale).toFixed(2);
            iconSymbols[\`\${entry.category}_\${idx}\`] = {
              paths: \`<g transform="translate(\${cx},\${cy}) scale(\${scale.toFixed(4)})">\${inner}</g>\`,
              stroke: false, srcSize: 16,
            };
          });
        }
      }
    }

    // ── Phase 2: static ICON_PATHS (pre-built, no CDN) ───────────────────────
    lbl.textContent = 'Ініціалізація символів…';
    bar.style.width = '70%';
    await tick();

    let built = 0;
    const missing = [];
    for (const entry of ICON_MAP) {
      entry.icons.forEach((ico, idx) => {
        if (!ico.lib) return;
        const key = \`\${entry.category}_\${idx}\`;
        if (ICON_PATHS[key]) {
          iconSymbols[key] = ICON_PATHS[key];
          built++;
        } else {
          missing.push(\`\${ico.lib}:\${ico.name}\`);
        }
      });
    }
    if (missing.length) console.warn('Missing pre-built icons:', missing);

    bar.style.width = '100%';
    bar.style.background = 'var(--green)';
    lbl.textContent = \`✓ \${built} іконок готові (offline)\`;
    iconsReady = true;
    document.getElementById('btn-gen').disabled = false;
  } catch (err) {
    console.error('loadIconsSprite:', err);
    lbl.textContent = '⚠ Помилка іконок: ' + err.message;
  }
}`;

newHtml = newHtml.slice(0, loaderStart) + NEW_LOADER + newHtml.slice(loaderEnd);

// ─── 9. Write result ──────────────────────────────────────────────────────────
fs.writeFileSync(HTML_FILE, newHtml);
console.log(`✅ favicon-studio.html updated (${(Buffer.byteLength(newHtml) / 1024).toFixed(0)} KB)`);
console.log('\n🎉 Done! Open favicon-studio.html — no CDN, no delays, no blocked buttons.\n');
