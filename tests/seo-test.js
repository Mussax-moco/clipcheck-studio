'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

var root = path.join(__dirname, '..');
var base = 'https://mussax-moco.github.io/clipcheck-studio/';
var pages = {
  'index.html': base,
  'about.html': base + 'about.html',
  'privacy.html': base + 'privacy.html',
  'contact.html': base + 'contact.html'
};
var html = {};
Object.keys(pages).forEach(function (file) {
  html[file] = fs.readFileSync(path.join(root, file), 'utf8');
});
var css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
var robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
var sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');

var passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('PASS ' + name);
}

function decode(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function matchOne(source, regex, label) {
  var match = regex.exec(source);
  assert.ok(match, label + ' is missing');
  return decode(match[1]);
}

function title(source) {
  return matchOne(source, /<title>([\s\S]*?)<\/title>/, 'title');
}

function meta(source, attribute, key) {
  var regex = new RegExp('<meta\\s+' + attribute + '="' + key + '"\\s+content="([^"]*)"');
  return matchOne(source, regex, attribute + '="' + key + '"');
}

function canonical(source) {
  return matchOne(source, /<link rel="canonical" href="([^"]+)">/, 'canonical');
}

function ids(source) {
  var result = {};
  var regex = /id="([^"]+)"/g;
  var match;
  while ((match = regex.exec(source))) result[match[1]] = true;
  return result;
}

function hrefs(source) {
  var result = [];
  var regex = /href="([^"]+)"/g;
  var match;
  while ((match = regex.exec(source))) result.push(decode(match[1]));
  return result;
}

function words(source) {
  var cleaned = source
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(' ').filter(Boolean).length;
}

function footer(source) {
  return matchOne(source, /<footer class="site-footer">([\s\S]*?)<\/footer>/, 'site footer');
}

test('every page has a unique title, one h1 and a unique description', function () {
  var titles = [];
  var descriptions = [];
  Object.keys(pages).forEach(function (file) {
    titles.push(title(html[file]));
    var description = meta(html[file], 'name', 'description');
    descriptions.push(description);
    assert.ok(description.length >= 70 && description.length <= 165, file + ' description length: ' + description.length);
    assert.equal((html[file].match(/<h1\b/g) || []).length, 1, file + ' must have exactly one h1');
    assert.ok(/<html lang="en">/.test(html[file]), file + ' must declare English');
  });
  assert.equal(new Set(titles).size, titles.length, 'duplicate page titles');
  assert.equal(new Set(descriptions).size, descriptions.length, 'duplicate meta descriptions');
});

test('canonical and social metadata use exact deployed URLs', function () {
  Object.keys(pages).forEach(function (file) {
    assert.equal(canonical(html[file]), pages[file], file + ' canonical URL');
    assert.equal(meta(html[file], 'property', 'og:url'), pages[file], file + ' og:url');
    assert.equal(meta(html[file], 'property', 'og:type'), 'website', file + ' og:type');
    assert.equal(meta(html[file], 'property', 'og:site_name'), 'ClipCheck Studio', file + ' og:site_name');
    assert.equal(meta(html[file], 'property', 'og:title'), title(html[file]), file + ' og:title');
    assert.ok(meta(html[file], 'property', 'og:description').length > 50, file + ' og:description');
    assert.equal(meta(html[file], 'name', 'twitter:card'), 'summary', file + ' twitter:card');
    assert.ok(meta(html[file], 'name', 'robots').indexOf('index') >= 0, file + ' robots meta');
  });
});

test('sitemap lists exactly the canonical pages with no placeholders', function () {
  var locs = (sitemap.match(/<loc>([^<]+)<\/loc>/g) || []).map(function (tag) {
    return tag.replace(/<\/?loc>/g, '');
  });
  assert.deepEqual(locs.slice().sort(), Object.keys(pages).map(function (file) { return pages[file]; }).sort());
  assert.ok(/^\<\?xml version="1.0" encoding="UTF-8"\?\>/.test(sitemap.trim()));
  assert.ok(sitemap.indexOf('http://www.sitemaps.org/schemas/sitemap/0.9') >= 0);
  assert.ok(!/example\.com|placeholder|your-domain|localhost/i.test(sitemap));
});

test('robots.txt allows crawling and references the absolute sitemap', function () {
  assert.match(robots, /User-agent:\s*\*/);
  assert.match(robots, /Allow:\s*\//);
  assert.ok(robots.indexOf('Sitemap: ' + base + 'sitemap.xml') >= 0);
  assert.ok(!/Disallow:\s*\//.test(robots));
});

test('all internal links and anchors resolve', function () {
  Object.keys(pages).forEach(function (file) {
    hrefs(html[file]).forEach(function (href) {
      if (/^(mailto:|tel:)/i.test(href)) {
        return;
      }
      if (/^https?:\/\//.test(href)) {
        var allowed = href.indexOf('https://github.com/Mussax-moco/clipcheck-studio') === 0 || href.indexOf(base) === 0 || href.indexOf('https://wa.me/923169006243') === 0;
        assert.ok(allowed, file + ' has unexpected external link: ' + href);
        return;
      }
      if (href.charAt(0) === '#') {
        assert.ok(ids(html[file])[href.slice(1)], file + ' has broken anchor ' + href);
        return;
      }
      var parts = href.split('#');
      var targetPath = path.resolve(root, parts[0]);
      assert.ok(fs.existsSync(targetPath), file + ' links to missing file ' + parts[0]);
      if (parts[1]) {
        var targetHtml = fs.readFileSync(targetPath, 'utf8');
        assert.ok(ids(targetHtml)[parts[1]], file + ' links to missing anchor ' + href);
      }
    });
  });
});

test('shared navigation and footer links appear on every page', function () {
  Object.keys(pages).forEach(function (file) {
    var links = hrefs(html[file]);
    ['about.html', 'privacy.html', 'contact.html', 'sitemap.xml'].forEach(function (href) {
      assert.ok(links.indexOf(href) >= 0, file + ' is missing ' + href);
    });
    assert.ok(links.indexOf('index.html') >= 0 || links.indexOf('index.html#checker') >= 0, file + ' is missing a home link');
  });
});

test('FAQ structured data matches visible answers', function () {
  var raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html['index.html']);
  assert.ok(raw, 'JSON-LD block is missing');
  var data = JSON.parse(raw[1]);
  var app = data['@graph'].find(function (node) { return node['@type'] === 'WebApplication'; });
  var faq = data['@graph'].find(function (node) { return node['@type'] === 'FAQPage'; });
  assert.ok(app && app.url === base, 'WebApplication structured data');
  assert.ok(faq && faq.mainEntity.length === 5, 'FAQPage structured data');
  faq.mainEntity.forEach(function (entry) {
    assert.ok(html['index.html'].indexOf(entry.name) >= 0, 'FAQ question is not visible: ' + entry.name);
    assert.ok(html['index.html'].indexOf(entry.acceptedAnswer.text.split('.')[0]) >= 0, 'FAQ answer is not visible');
  });
  assert.ok((html['index.html'].match(/<details>/g) || []).length >= 5, 'visible FAQ details');
});

test('pages contain original, non-thin content', function () {
  var minimums = { 'index.html': 800, 'about.html': 300, 'privacy.html': 350, 'contact.html': 250 };
  Object.keys(minimums).forEach(function (file) {
    var count = words(html[file]);
    assert.ok(count >= minimums[file], file + ' only has ' + count + ' words');
  });
});

test('responsive header and content styles are present', function () {
  assert.ok(/\.header-inner\s*\{[^}]*flex-wrap:\s*wrap/.test(css));
  assert.ok(/\.faq-list\s*\{/.test(css));
  assert.ok(/\.prose\s*\{/.test(css));
  assert.ok(/@media \(min-width: 640px\)/.test(css));
  assert.ok(/@media \(min-width: 860px\)/.test(css));
  assert.ok(/\.header-inner\s*\{\s*flex-wrap:\s*nowrap/.test(css));
  assert.ok(/prefers-reduced-motion/.test(css));
});

test('every page has a professional footer with required links, credit and copyright', function () {
  var requiredLinks = [
    ['index.html', 'Home'],
    ['about.html', 'About Us'],
    ['contact.html', 'Contact Us'],
    ['privacy.html', 'Privacy Policy']
  ];
  Object.keys(pages).forEach(function (file) {
    var mark = footer(html[file]);
    requiredLinks.forEach(function (entry) {
      assert.ok(mark.indexOf('<a href="' + entry[0] + '">' + entry[1] + '</a>') >= 0, file + ' footer is missing ' + entry[1]);
    });
    assert.ok(mark.indexOf('Created with care by Ghulam Mustafa') >= 0, file + ' footer credit');
    assert.ok(mark.indexOf('href="mailto:mustafaalee305@gmail.com"') >= 0, file + ' footer email link');
    assert.ok(mark.indexOf('href="tel:+923169006243"') >= 0, file + ' footer phone link');
    assert.ok(mark.indexOf('href="https://wa.me/923169006243"') >= 0, file + ' footer WhatsApp link');
    assert.ok(mark.indexOf('© 2026 ClipCheck Studio. All Rights Reserved.') >= 0, file + ' footer copyright');
    assert.ok(mark.indexOf('href="sitemap.xml"') >= 0, file + ' footer sitemap link');
  });
});

test('contact page publishes confirmed owner contact details and social placeholder', function () {
  var source = html['contact.html'];
  assert.ok(source.indexOf('Ghulam Mustafa') >= 0, 'contact owner name');
  assert.ok(source.indexOf('<h1 id="contact-title">Contact Us</h1>') >= 0, 'contact h1');
  assert.ok(source.indexOf('href="mailto:mustafaalee305@gmail.com"') >= 0, 'contact email link');
  assert.ok(source.indexOf('mustafaalee305@gmail.com') >= 0, 'contact email text');
  assert.ok(source.indexOf('href="tel:+923169006243"') >= 0, 'contact phone link');
  assert.ok(source.indexOf('+92 316 9006243') >= 0, 'contact phone text');
  assert.ok(source.indexOf('href="https://wa.me/923169006243"') >= 0, 'contact WhatsApp link');
  assert.ok(source.indexOf('To be added: official social profiles') >= 0, 'social placeholder');
  assert.ok(!/To be added: public email address/.test(source), 'stale email placeholder');
  assert.ok(!/To be added: public phone number/.test(source), 'stale phone placeholder');
  assert.ok(!/Placeholder — to be added/.test(source), 'stale generic placeholder');
  assert.ok(!/direct contact details are pending/i.test(source), 'stale pending description');
});

test('about page credits the owner', function () {
  assert.ok(html['about.html'].indexOf('Ghulam Mustafa') >= 0, 'about owner name');
});

test('contact and footer styles are present with responsive breakpoints', function () {
  assert.ok(/\.contact-layout\s*\{[^}]*display:\s*grid/.test(css));
  assert.ok(/\.contact-card\s*\{/.test(css));
  assert.ok(/\.contact-card-direct\s*\{/.test(css));
  assert.ok(/\.footer-credit\s*\{/.test(css));
  assert.ok(/\.footer-contact\s*\{/.test(css));
  assert.ok(/\.footer-legal\s*\{/.test(css));
  assert.ok(/@media \(min-width: 640px\)[\s\S]*?\.contact-layout\s*\{\s*grid-template-columns:\s*repeat\(2,/.test(css));
  assert.ok(/@media \(min-width: 860px\)[\s\S]*?\.contact-layout\s*\{\s*grid-template-columns:\s*repeat\(3,/.test(css));
});

console.log('\n' + passed + ' SEO/link tests passed.');
