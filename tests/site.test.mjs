import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const publicDir = new URL('../public/', import.meta.url);
const htmlPath = new URL('../public/index.html', import.meta.url);
const stylesPath = new URL('../public/styles.css', import.meta.url);
const sitemapPath = new URL('../public/sitemap.xml', import.meta.url);
const publicPath = resolve(fileURLToPath(publicDir));

const html = () => readFileSync(htmlPath, 'utf8');
const css = () => readFileSync(stylesPath, 'utf8');

function publicFile(relative) {
  return new URL(relative.replace(/^\.\//, ''), publicDir);
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function htmlTags(source) {
  return [...source.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)].map((match) => ({
    name: match[1].toLowerCase(),
    attributes: parseAttributes(match[2]),
  }));
}

function urlCandidates(value, attribute) {
  if (attribute !== 'srcset') return [value.trim()];
  return value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean);
}

function htmlURLReferences(source) {
  const references = [];
  for (const tag of htmlTags(source)) {
    for (const attribute of ['src', 'href', 'srcset']) {
      const value = tag.attributes[attribute];
      if (value === undefined) continue;
      for (const candidate of urlCandidates(value, attribute)) {
        references.push({ tag: tag.name, attribute, value: candidate, attributes: tag.attributes });
      }
    }
  }
  return references;
}

function cssURLReferences(source) {
  return [...source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)]
    .map((match) => ({ tag: 'css', attribute: 'url()', value: (match[1] ?? match[2] ?? match[3]).trim() }));
}

function resourceReferences(page, styles) {
  const htmlReferences = htmlURLReferences(page).filter(({ tag, attribute, value, attributes }) => {
    if (attribute === 'href' && tag === 'a') return false;
    if (attribute === 'href' && tag === 'link' && attributes.rel?.toLowerCase().split(/\s+/).includes('canonical')) return false;
    if (attribute === 'href' && value.startsWith('#')) return false;
    return true;
  });
  return [...htmlReferences, ...cssURLReferences(styles)];
}

function assertResourcesStayLocal(page, styles) {
  for (const reference of resourceReferences(page, styles)) {
    const label = `<${reference.tag}> ${reference.attribute}=${reference.value}`;
    assert.ok(!reference.value.startsWith('//'), `${label} must not use a protocol-relative URL`);
    assert.ok(!reference.value.startsWith('/'), `${label} must use a path inside public/`);
    assert.ok(!/^[a-z][a-z\d+.-]*:/i.test(reference.value), `${label} must use a local URL`);
  }
}

function assertLocalReferencesExist(page, styles) {
  const references = [...htmlURLReferences(page), ...cssURLReferences(styles)];
  for (const reference of references) {
    const value = reference.value;
    if (value.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(value)) continue;
    assert.ok(!value.startsWith('//'), `${value} must not use a protocol-relative URL`);

    const target = resolve(fileURLToPath(new URL(value, publicDir)));
    const label = `${reference.attribute} ${value}`;
    assert.ok(target === publicPath || target.startsWith(`${publicPath}${sep}`), `${label} stays inside public/`);
    assert.ok(existsSync(target), `${label} resolves to a file in public/`);
  }
}

function assertImagesHaveAlt(page) {
  for (const image of htmlTags(page).filter(({ name }) => name === 'img')) {
    assert.ok(Object.hasOwn(image.attributes, 'alt'), '<img> has an alt attribute');
  }
}

function assertInPageLinksResolve(page) {
  const ids = new Set(htmlTags(page).map(({ attributes }) => attributes.id).filter((id) => id !== undefined));
  const links = htmlURLReferences(page).filter(({ attribute, value }) => attribute === 'href' && value.startsWith('#'));
  for (const { tag, value } of links) {
    const id = decodeURIComponent(value.slice(1).split(/[?#]/, 1)[0]);
    assert.ok(ids.has(id), `<${tag}> href="${value}" points to an id on the page`);
  }
}

function mediaBlocks(source, query) {
  const expected = query.replace(/\s+/g, '').toLowerCase();
  const blocks = [];
  const pattern = /@media\s*\(([^)]*)\)\s*\{/gi;
  let match;
  while ((match = pattern.exec(source))) {
    if (match[1].replace(/\s+/g, '').toLowerCase() !== expected) continue;
    const open = source.indexOf('{', match.index);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') depth -= 1;
      if (depth === 0) {
        blocks.push(source.slice(open + 1, index));
        break;
      }
    }
  }
  return blocks;
}

function pngDimensions(path) {
  const image = readFileSync(path);
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path} is a PNG`);
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

test('the page leads with the three ideas in order and the state A copy', () => {
  const page = html();
  assert.match(page, /<h1 id="hero-title"><span>Host it yourself\.<\/span> <span>Keep it private\.<\/span> <span>Just a username\.<\/span><\/h1>/);
  assert.match(page, /Sign up with a username and a password: no phone number, no email\./);
  assert.match(page, /Teagram Web is coming soon\./);
  assert.match(page, /href="https:\/\/github\.com\/teagramhq\/teagram-desktop\/releases"[^>]*>Download for macOS</);
  assert.match(page, /Free\. For Macs with Apple silicon and macOS 13 or later\./);
  assert.match(page, /<p class="pill">Coming soon<\/p>/);
  assert.doesNotMatch(page, /Open Teagram Web/, 'state B copy waits for public sign-up (MAIN-2194)');
  assert.doesNotMatch(page, /The app installs its own updates\./i, 'the desktop updater is not available yet');
  assert.match(page, /or wait for Teagram Web, coming soon\./i);
  assert.doesNotMatch(page, /where anyone can sign up/i, 'Web sign-up still needs an invite (MAIN-2194)');
});

test('the page keeps its sections, anchors and FAQ answers in the spec order', () => {
  const page = html();
  const order = [
    'class="hero"',
    'class="showcase"',
    'id="why"',
    'id="get"',
    'id="faq"',
    'class="site-footer"',
  ];
  let last = -1;
  for (const marker of order) {
    const at = page.indexOf(marker);
    assert.ok(at > last, `${marker} follows the previous section`);
    last = at;
  }
  for (const id of ['faq-what', 'faq-telegram', 'faq-privacy', 'faq-data', 'faq-cost', 'faq-account', 'faq-open', 'faq-platforms']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.match(page, /<h2 id="why-title">Why Teagram<\/h2>/);
  assert.match(page, /<h2 id="get-title">Get Teagram<\/h2>/);
  assert.match(page, /<h2 id="faq-title">Frequently asked questions<\/h2>/);
});

test('the footer keeps the not-affiliated and licence notes', () => {
  const page = html();
  assert.match(page, /Teagram is not affiliated with Telegram\./);
  assert.match(page, /href="https:\/\/www\.gnu\.org\/licenses\/gpl-3\.0\.html">GPL-3\.0</);
  assert.match(page, /href="https:\/\/www\.gnu\.org\/licenses\/agpl-3\.0\.html">AGPL-3\.0</);
  assert.match(page, /aria-label="Source code"/);
});

test('the page provides accessible metadata and a skip link', () => {
  const page = html();
  assert.match(page, /<html lang="en">/);
  assert.match(page, /<meta name="description" content="Teagram is a messenger you can host yourself/);
  assert.match(page, /<meta name="color-scheme" content="light dark">/);
  assert.match(page, /<meta name="theme-color" content="#F7FAF8" media="\(prefers-color-scheme: light\)">/);
  assert.match(page, /<meta name="theme-color" content="#0A0F1A" media="\(prefers-color-scheme: dark\)">/);
  assert.match(page, /<a class="skip-link" href="#main">Skip to content<\/a>/);
  assert.match(page, /<main id="main">/);
  assert.match(page, /<nav class="site-nav" aria-label="Main">/);
  assert.match(page, /alt="Teagram for Mac with a group chat open next to the chat list"/);
  assert.match(page, /alt="Teagram Web in a phone-sized browser window, showing the same group chat"/);
  assert.match(page, /<svg class="stage-tail" viewBox="0 0 136 112" aria-hidden="true" focusable="false">/);
});

test('canonical, og and twitter metadata use the production domain', () => {
  const page = html();
  assert.match(page, /<link rel="canonical" href="https:\/\/teagram\.io\/">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/teagram\.io\/">/);
  assert.match(page, /<meta property="og:image" content="https:\/\/teagram\.io\/assets\/teagram-social\.png">/);
  assert.match(page, /<meta name="twitter:image" content="https:\/\/teagram\.io\/assets\/teagram-social\.png">/);
  assert.match(page, /<meta property="og:image:width" content="1200">/);
  assert.match(page, /<meta property="og:image:height" content="630">/);
  assert.match(page, /<meta name="twitter:card" content="summary_large_image">/);
  assert.doesNotMatch(page, /github\.io/i);

  const socialImage = publicFile('assets/teagram-social.png');
  assert.ok(existsSync(socialImage), 'the social image exists at the metadata URL');
  assert.deepEqual(pngDimensions(socialImage), { width: 1200, height: 630 });

  assert.ok(existsSync(sitemapPath), 'sitemap.xml is deployed with the site');
  assert.match(readFileSync(sitemapPath, 'utf8'), /<loc>https:\/\/teagram\.io\/<\/loc>/);
});

test('every local file the page loads exists in public/', () => {
  const page = html();
  assertLocalReferencesExist(page, css());
  assertImagesHaveAlt(page);
  assertInPageLinksResolve(page);
});

test('the page loads nothing from another origin and runs no script', () => {
  const page = html();
  assert.doesNotMatch(page, /<script\b/i);
  assertResourcesStayLocal(page, css());
  assert.doesNotMatch(css(), /@import|url\(\s*["']?https?:/i);
  assert.doesNotMatch(page, /https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.)/i);
});

test('reference checks catch reordered attributes, protocol-relative URLs and quoted local paths', () => {
  assert.throws(
    () => assertResourcesStayLocal('<link rel="stylesheet" href="https://other.example/x.css">', ''),
    /must use a local URL/,
  );
  assert.throws(
    () => assertResourcesStayLocal('<img src="//host.example/image.png" alt="">', ''),
    /protocol-relative/,
  );
  assert.throws(
    () => assertResourcesStayLocal('<source srcset="./local.webp 1x, //host.example/remote.webp 2x">', ''),
    /protocol-relative/,
  );
  assert.throws(
    () => assertResourcesStayLocal('', 'body { background: url(\'//host.example/image.png\'); }'),
    /protocol-relative/,
  );
  assert.throws(
    () => assertLocalReferencesExist('<img src="assets/missing.webp" alt="">', ''),
    /assets\/missing\.webp resolves to a file/,
  );
  assert.throws(
    () => assertLocalReferencesExist('', "@font-face { src: url('./assets/fonts/missing.woff2'); }"),
    /\.\/assets\/fonts\/missing\.woff2 resolves to a file/,
  );
  assert.throws(() => assertImagesHaveAlt('<img src="./assets/brand/t-primary-64.png">'), /alt attribute/);
  assert.throws(() => assertInPageLinksResolve('<a href="#missing">FAQ</a>'), /points to an id/);
});

test('the product visual ships WebP shots within their size budgets', () => {
  const budgets = [
    ['assets/shots/mac-light.webp', 200 * 1024],
    ['assets/shots/mac-dark.webp', 200 * 1024],
    ['assets/shots/web-light.webp', 100 * 1024],
    ['assets/shots/web-dark.webp', 100 * 1024],
  ];
  for (const [file, budget] of budgets) {
    const url = publicFile(file);
    assert.ok(existsSync(url), `${file} exists`);
    assert.ok(statSync(url).size <= budget, `${file} is within ${budget} bytes`);
    const head = readFileSync(url).subarray(0, 12).toString('latin1');
    assert.match(head, /^RIFF....WEBP$/s, `${file} is WebP`);
  }
  const page = html();
  assert.match(page, /<source media="\(prefers-color-scheme: dark\)" srcset="\.\/assets\/shots\/mac-dark\.webp">/);
  assert.match(page, /width="1680" height="1050" fetchpriority="high"/);
  assert.match(page, /width="520" height="1125"/);
});

test('the brand and font files are self-hosted and the licence ships with the font', () => {
  assert.ok(existsSync(publicFile('assets/fonts/besley-500.woff2')), 'Besley is self-hosted');
  assert.match(readFileSync(publicFile('assets/fonts/OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(html(), /<link rel="preload" href="\.\/assets\/fonts\/besley-500\.woff2" as="font" type="font\/woff2" crossorigin>/);
  assert.match(css(), /@font-face\s*{[^}]*font-display:\s*swap/s);
  assert.ok(existsSync(publicFile('assets/brand/mug-signal-256.png')), 'Mac card icon is the mug-signal mark');
  assert.ok(existsSync(publicFile('assets/brand/t-primary-64.png')), 'header mark is t-primary');
});

test('the stylesheet covers dark mode, the phone breakpoints, focus and reduced motion', () => {
  const styles = css();
  const [darkMode] = mediaBlocks(styles, 'prefers-color-scheme: dark');
  const [phone] = mediaBlocks(styles, 'max-width: 419px');
  const [wide] = mediaBlocks(styles, 'min-width: 640px');
  const [reducedMotion] = mediaBlocks(styles, 'prefers-reduced-motion: reduce');
  assert.ok(darkMode, 'dark mode media rule exists');
  assert.ok(phone, 'phone breakpoint exists');
  assert.ok(wide, 'wide viewport breakpoint exists');
  assert.ok(reducedMotion, 'reduced-motion media rule exists');
  assert.match(darkMode, /--page\s*:\s*#0a0f1a\s*;/i);
  assert.match(phone, /\.actions\s+\.btn\s*,\s*\.get-action\s+\.btn\s*{[^}]*width\s*:\s*100%\s*;/s);
  assert.match(wide, /--gutter\s*:\s*32px\s*;/i);
  assert.match(reducedMotion, /html\s*{[^}]*scroll-behavior\s*:\s*auto\s*;/s);
  assert.match(reducedMotion, /\.btn\s*{[^}]*transition\s*:\s*none\s*;/s);
  assert.match(styles, /:focus-visible\s*{[^}]*outline\s*:\s*3px solid var\(--accent\)/s);
  assert.doesNotMatch(styles, /outline:\s*none/);
});

test('the page holds no personal data, private hostnames or banned claims', () => {
  const page = html();
  const styles = css();
  assert.doesNotMatch(page + styles, /\.ts\.net/i);
  assert.doesNotMatch(page, /[\w.+-]+@[\w-]+\.[\w.]+/, 'no email address');
  assert.doesNotMatch(page, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'no IP address');
  for (const phrase of [
    'nothing identifiable',
    'anonymous',
    'untraceable',
    'no logs',
    'from us',
    'zero-knowledge',
    'fully private',
    'completely private',
    'early development',
    'no public sign-up or downloads yet',
  ]) {
    assert.doesNotMatch(page, new RegExp(phrase, 'i'), `page does not say "${phrase}"`);
  }
});

test('every shipped text file avoids personal handles and private addresses', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(next);
      else if (/\.(html|css|svg|xml|txt)$/.test(entry.name)) files.push(next);
    }
  };
  walk(publicDir);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\.ts\.net|tailaa4918/i, `${file.pathname} has no private hostname`);
  }
});
