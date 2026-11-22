'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var cc = require('../app.js');

var root = path.join(__dirname, '..');
var passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log('PASS ' + name);
}

function titles(result) {
  return result.issues.map(function (issue) { return issue.title; });
}

function cleanSrt() {
  return [
    '1',
    '00:00:00,000 --> 00:00:02,000',
    'Hello there.',
    '',
    '2',
    '00:00:02,100 --> 00:00:05,000',
    'A second shorter line.',
    ''
  ].join('\n');
}

function makeCtx() {
  var calls = { clear: [], fill: [], stroke: [], text: [], dash: [] };
  return {
    calls: calls,
    set fillStyle(value) {},
    set strokeStyle(value) {},
    set lineWidth(value) {},
    set font(value) {},
    set textAlign(value) {},
    set textBaseline(value) {},
    clearRect: function () { calls.clear.push(Array.prototype.slice.call(arguments)); },
    fillRect: function () { calls.fill.push(Array.prototype.slice.call(arguments)); },
    strokeRect: function () { calls.stroke.push(Array.prototype.slice.call(arguments)); },
    setLineDash: function (value) { calls.dash.push(value); },
    measureText: function (value) { return { width: String(value).length * 10 }; },
    fillText: function () { calls.text.push(Array.prototype.slice.call(arguments)); }
  };
}

function covers(rect, x, y) {
  return x >= rect[0] && x <= rect[0] + rect[2] && y >= rect[1] && y <= rect[1] + rect[3];
}

test('formatBytes handles units and invalid input', function () {
  assert.equal(cc.formatBytes(512), '512 B');
  assert.equal(cc.formatBytes(1024), '1.00 KB');
  assert.equal(cc.formatBytes(5 * 1024 * 1024), '5.00 MB');
  assert.equal(cc.formatBytes(-1), '—');
});

test('duration and SRT time formatting', function () {
  assert.equal(cc.formatDuration(65.25), '1m 5s 250ms');
  assert.equal(cc.formatDuration(null), 'Not available');
  assert.equal(cc.formatSrtTime(3661250), '01:01:01,250');
});

test('aspect ratio simplification', function () {
  assert.equal(cc.simplifyRatio(1080, 1920), '9:16');
  assert.equal(cc.simplifyRatio(1920, 1080), '16:9');
  assert.equal(cc.simplifyRatio(0, 100), '—');
});

test('timestamp parsing accepts comma, dot and settings', function () {
  assert.deepEqual(cc.parseTimestampLine('00:00:01,500 --> 00:00:03,000'), { start: 1500, end: 3000 });
  assert.deepEqual(cc.parseTimestampLine('01:02:03.004 --> 01:02:04.005 align:start'), { start: 3723004, end: 3724005 });
  assert.equal(cc.parseTimestampLine('00:00:01 --> 00:00:02'), null);
});

test('valid SRT produces no findings', function () {
  var result = cc.parseSrt(cleanSrt());
  assert.equal(result.stats.cues, 2);
  assert.equal(result.stats.errors, 0);
  assert.equal(result.stats.warnings, 0);
  assert.equal(result.issues.length, 0);
});

test('SRT parser handles BOM and CRLF', function () {
  var text = '\uFEFF' + cleanSrt().replace(/\n/g, '\r\n');
  assert.equal(cc.parseSrt(text).stats.cues, 2);
});

test('SRT parser detects overlaps and bad time order', function () {
  var overlapping = cc.parseSrt('1\n00:00:00,000 --> 00:00:04,000\nOne.\n\n2\n00:00:03,000 --> 00:00:05,000\nTwo.');
  assert.ok(titles(overlapping).indexOf('Cue overlaps the previous cue') >= 0);
  var reversed = cc.parseSrt('1\n00:00:05,000 --> 00:00:02,000\nOne.');
  assert.ok(titles(reversed).indexOf('End time is not after start time') >= 0);
});

test('SRT parser detects numbering and structure errors', function () {
  var unordered = cc.parseSrt('1\n00:00:00,000 --> 00:00:01,000\nOne.\n\n3\n00:00:01,200 --> 00:00:02,000\nTwo.');
  assert.ok(titles(unordered).indexOf('Cue numbers out of order') >= 0);
  var missingTime = cc.parseSrt('1\nThis is not a timestamp.\nOne.');
  assert.ok(titles(missingTime).indexOf('Timestamp line missing') >= 0);
  var empty = cc.parseSrt('1\n00:00:00,000 --> 00:00:01,000');
  assert.ok(titles(empty).indexOf('Empty subtitle cue') >= 0);
  var unnumbered = cc.parseSrt('00:00:00,000 --> 00:00:01,000\nOne.');
  assert.ok(titles(unnumbered).indexOf('Cue number missing') >= 0);
});

test('SRT parser warns on long lines, fast reading and short cues', function () {
  var fast = cc.parseSrt('1\n00:00:00,000 --> 00:00:00,500\nThis sentence is far too long for one second.');
  assert.ok(titles(fast).indexOf('Reading speed is too high') >= 0);
  assert.ok(titles(fast).indexOf('Very short cue') >= 0);
  var long = cc.parseSrt('1\n00:00:00,000 --> 00:00:06,000\n' + 'x'.repeat(60));
  assert.ok(titles(long).indexOf('Line is very long') >= 0);
  var multiline = cc.parseSrt('1\n00:00:00,000 --> 00:00:06,000\nOne.\nTwo.\nThree.');
  assert.ok(titles(multiline).indexOf('Too many lines in one cue') >= 0);
  assert.ok(cc.parseSrt('').stats.errors === 1);
});

test('media checks reflect orientation, resolution, duration and size', function () {
  var good = cc.evaluateMedia({ width: 1080, height: 1920, duration: 30, size: 20 * 1024 * 1024, kind: 'video' }, 'tiktok');
  assert.equal(good.filter(function (c) { return c.level === 'bad'; }).length, 0);
  var landscape = cc.evaluateMedia({ width: 1920, height: 1080, duration: 30, size: 20 * 1024 * 1024, kind: 'video' }, 'reels');
  assert.ok(landscape.some(function (c) { return c.level === 'bad' && /Landscape/.test(c.text); }));
  var tiny = cc.evaluateMedia({ width: 320, height: 568, duration: 30, size: 20 * 1024 * 1024, kind: 'video' }, 'shorts');
  assert.ok(tiny.some(function (c) { return c.level === 'bad' && /low resolution/i.test(c.text); }));
  var long = cc.evaluateMedia({ width: 1080, height: 1920, duration: 240, size: 20 * 1024 * 1024, kind: 'video' }, 'shorts');
  assert.ok(long.some(function (c) { return /current upload limit/.test(c.text); }));
  var image = cc.evaluateMedia({ width: 1080, height: 1920, duration: null, size: 1024, kind: 'image' }, 'tiktok');
  assert.ok(image.some(function (c) { return /Image loaded/.test(c.text); }));
  var empty = cc.evaluateMedia({ width: 1080, height: 1920, duration: 10, size: 0, kind: 'video' }, 'tiktok');
  assert.ok(empty.some(function (c) { return c.level === 'bad' && /empty/.test(c.text); }));
});

test('PNG overlay is drawn with transparent centre and correct bands', function () {
  var ctx = makeCtx();
  var rects = cc.drawOverlay(ctx, { width: 1080, height: 1920, area: cc.SAFE_AREAS.tiktok, labels: true });
  assert.equal(rects.length, 4);
  assert.deepEqual(ctx.calls.clear[0], [0, 0, 1080, 1920]);
  assert.equal(ctx.calls.stroke.length, 4);
  var zones = ctx.calls.fill.slice(0, 4);
  assert.equal(zones[0][3], 250);
  assert.equal(zones[1][1], 1498);
  assert.equal(zones[2][0], 929);
  assert.ok(!zones.some(function (rect) { return covers(rect, 540, 960); }));
  assert.ok(ctx.calls.text.some(function (call) { return call[0] === 'TOP UI'; }));
  assert.ok(ctx.calls.text.some(function (call) { return call[0] === 'BUTTONS'; }));

  var plainCtx = makeCtx();
  cc.drawOverlay(plainCtx, { width: 720, height: 1280, area: cc.SAFE_AREAS.reels, labels: false });
  assert.equal(plainCtx.calls.text.length, 0);
});

test('HTML and JavaScript IDs are wired together', function () {
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  var css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  var htmlIds = {};
  html.replace(/id="([^"]+)"/g, function (_, id) { htmlIds[id] = true; return _; });
  var referenced = {};
  js.replace(/byId\('([^']+)'\)/g, function (_, id) { referenced[id] = true; return _; });
  Object.keys(referenced).forEach(function (id) {
    assert.ok(htmlIds[id], 'Missing HTML id: ' + id);
  });
  assert.ok(/name="platform"/.test(html));
  assert.ok(/<meta name="description"/.test(html));
  assert.ok(/<h1/.test(html));
  assert.ok(/\.preview-stage/.test(css));
});

console.log('\n' + passed + ' tests passed.');
