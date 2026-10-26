import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const htmlPath = new URL('../public/index.html', import.meta.url);
const stylesPath = new URL('../public/styles.css', import.meta.url);
const sitemapPath = new URL('../public/sitemap.xml', import.meta.url);

test('the landing page explains Teagram and links to its public projects', () => {
  assert.ok(existsSync(htmlPath), 'index.html serves the landing page');

  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /messaging app with its own server/i);
  assert.match(html, /macOS/i);
  assert.match(html, /web client in progress/i);
  assert.match(html, /username and password/i);
  assert.match(html, /no phone numbers/i);
  assert.match(html, /early development/i);
  assert.match(html, /no public sign-up or downloads yet/i);
  assert.match(html, /https:\/\/github\.com\/teagramhq\/teagram-server/);
  assert.match(html, /https:\/\/github\.com\/teagramhq\/teagram-desktop/);
  assert.match(html, /https:\/\/github\.com\/teagramhq\/teagram-web/);
  assert.match(html, /not affiliated with Telegram/i);
  assert.match(html, /GPL-3\.0/);
});

test('the page provides accessible metadata and self-hosted brand assets', () => {
  assert.ok(existsSync(htmlPath), 'index.html serves the landing page');

  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="description"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /<img[^>]+alt="Teagram"/);
  assert.match(html, /assets\/brand\/t-(?:paper|night)-128\.png/);
  assert.match(html, /assets\/brand\/t-primary-32\.png/);
  assert.ok(existsSync(new URL('../public/assets/brand/t-primary-32.png', import.meta.url)));
  assert.ok(existsSync(new URL('../public/assets/teagram-social.png', import.meta.url)));
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.)/i);
});

test('the site uses its production domain for metadata and sitemap', () => {
  const html = readFileSync(htmlPath, 'utf8');

  assert.match(html, /<link rel="canonical" href="https:\/\/teagram\.io\//);
  assert.match(html, /<meta property="og:url" content="https:\/\/teagram\.io\//);
  assert.match(html, /<meta property="og:image" content="https:\/\/teagram\.io\//);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/teagram\.io\//);
  assert.doesNotMatch(html, /github\.io/i);

  assert.ok(existsSync(sitemapPath), 'sitemap.xml is deployed with the site');
  const sitemap = readFileSync(sitemapPath, 'utf8');
  assert.match(sitemap, /<loc>https:\/\/teagram\.io\/<\/loc>/);
});

test('the stylesheet adapts to dark mode and narrow screens', () => {
  assert.ok(existsSync(stylesPath), 'styles.css styles the landing page');

  const css = readFileSync(stylesPath, 'utf8');
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /max-width:\s*\d+px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /::selection\s*{[^}]*color:\s*var\(--button-text\)/s);
  assert.match(css, /prefers-reduced-motion/);
});
