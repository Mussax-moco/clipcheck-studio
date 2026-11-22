(function (global) {
  'use strict';

  var SAFE_AREAS = {
    tiktok: { top: 0.13, bottom: 0.22, right: 0.14, left: 0.02 },
    reels: { top: 0.10, bottom: 0.22, right: 0.12, left: 0.02 },
    shorts: { top: 0.10, bottom: 0.18, right: 0.12, left: 0.02 }
  };

  var PLATFORM_LABELS = {
    tiktok: 'TikTok',
    reels: 'Instagram Reels',
    shorts: 'YouTube Shorts'
  };

  var TIMESTAMP_LINE = /^\s*(\d{1,3}):([0-5]?\d):([0-5]?\d)[,.](\d{1,3})\s*-->\s*(\d{1,3}):([0-5]?\d):([0-5]?\d)[,.](\d{1,3})(?:\s+.*)?$/;
  var TIME_TOKEN = /^(\d{1,3}):([0-5]?\d):([0-5]?\d)[,.](\d{1,3})$/;

  function formatBytes(bytes) {
    var value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1024) return value + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var index = -1;
    do {
      value /= 1024;
      index += 1;
    } while (value >= 1024 && index < units.length - 1);
    return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2) + ' ' + units[index];
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'Not available';
    var total = Math.max(0, Math.round(seconds * 1000));
    var hours = Math.floor(total / 3600000);
    var minutes = Math.floor((total % 3600000) / 60000);
    var secs = Math.floor((total % 60000) / 1000);
    var ms = total % 1000;
    var base = (hours ? hours + 'h ' : '') + minutes + 'm ' + secs + 's';
    return ms && !hours ? base + ' ' + ms + 'ms' : base;
  }

  function formatSrtTime(ms) {
    var total = Math.max(0, Math.round(ms));
    var h = Math.floor(total / 3600000);
    var m = Math.floor((total % 3600000) / 60000);
    var s = Math.floor((total % 60000) / 1000);
    var milli = total % 1000;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(milli).padStart(3, '0');
  }

  function gcd(a, b) {
    while (b) {
      var t = b;
      b = a % b;
      a = t;
    }
    return a;
  }

  function simplifyRatio(width, height) {
    if (!width || !height) return '—';
    var divisor = gcd(Math.round(width), Math.round(height)) || 1;
    return Math.round(width) / divisor + ':' + Math.round(height) / divisor;
  }

  function parseTimeToken(token) {
    var match = TIME_TOKEN.exec(String(token).trim());
    if (!match) return null;
    return (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number(match[4].padEnd(3, '0'));
  }

  function parseTimestampLine(line) {
    var match = TIMESTAMP_LINE.exec(line);
    if (!match) return null;
    var start = parseTimeToken(line.slice(0, line.indexOf('-->')).trim());
    var end = parseTimeToken(match[5] + ':' + match[6] + ':' + match[7] + ',' + match[8]);
    if (start === null || end === null) return null;
    return { start: start, end: end };
  }

  function stripTags(value) {
    return String(value).replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim();
  }

  function parseSrt(raw) {
    var issues = [];
    var cues = [];
    var normalized = String(raw === null || raw === undefined ? '' : raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var lines = normalized.split('\n').map(function (text, index) {
      return { text: text, num: index + 1 };
    });
    var blocks = [];
    var current = null;

    lines.forEach(function (line) {
      if (line.text.trim() === '') {
        if (current) {
          blocks.push(current);
          current = null;
        }
        return;
      }
      if (!current) current = { startLine: line.num, lines: [] };
      current.lines.push(line);
    });
    if (current) blocks.push(current);

    if (!blocks.length) {
      issues.push({
        severity: 'error',
        line: 1,
        title: 'No subtitle cues found',
        detail: 'Add at least one cue with a number, a timestamp line and subtitle text.'
      });
      return finalizeSrt(cues, issues);
    }

    var expected = 1;
    var previous = null;

    blocks.forEach(function (block) {
      var timestampIndex = block.lines.findIndex(function (line) {
        return TIMESTAMP_LINE.test(line.text);
      });
      if (timestampIndex === -1) {
        timestampIndex = block.lines.findIndex(function (line) {
          return line.text.indexOf('-->') !== -1;
        });
      }

      if (timestampIndex === -1) {
        issues.push({
          severity: 'error',
          line: block.startLine,
          title: 'Timestamp line missing',
          detail: 'Expected a line in the form 00:00:01,000 --> 00:00:04,000.'
        });
        if (/^\d+$/.test(block.lines[0].text.trim())) expected += 1;
        return;
      }

      if (timestampIndex === 0) {
        issues.push({
          severity: 'warning',
          line: block.startLine,
          title: 'Cue number missing',
          detail: 'Most players expect an increasing number above each timestamp line.'
        });
      } else {
        var before = block.lines.slice(0, timestampIndex);
        var numberText = before[0].text.trim();
        if (before.length !== 1 || !/^\d+$/.test(numberText)) {
          issues.push({
            severity: 'error',
            line: before[0].num,
            title: 'Unexpected text before timestamp',
            detail: 'The cue number must be a whole number on its own line.'
          });
        } else if (Number(numberText) !== expected) {
          issues.push({
            severity: 'error',
            line: before[0].num,
            title: 'Cue numbers out of order',
            detail: 'Expected cue ' + expected + ', found ' + numberText + '.'
          });
        }
      }
      expected += 1;

      var timestampLine = block.lines[timestampIndex];
      var times = parseTimestampLine(timestampLine.text);
      if (!times) {
        issues.push({
          severity: 'error',
          line: timestampLine.num,
          title: 'Timestamp could not be read',
          detail: 'Check the HH:MM:SS,mmm format on both sides of the arrow.'
        });
        return;
      }

      var textLines = block.lines.slice(timestampIndex + 1).map(function (line) {
        return stripTags(line.text);
      }).filter(Boolean);

      if (!textLines.length) {
        issues.push({
          severity: 'error',
          line: timestampLine.num,
          title: 'Empty subtitle cue',
          detail: 'This timestamp has no text below it.'
        });
        return;
      }

      var duration = (times.end - times.start) / 1000;
      var characters = textLines.join('').replace(/\s+/g, '').length;
      var cps = duration > 0 ? characters / duration : 0;
      var longestLine = textLines.reduce(function (max, line) {
        return Math.max(max, line.length);
      }, 0);
      var unnumbered = timestampIndex === 0 ? null : Number(block.lines[0].text.trim());

      if (times.end <= times.start) {
        issues.push({
          severity: 'error',
          line: timestampLine.num,
          title: 'End time is not after start time',
          detail: 'The end timestamp must be later than the start timestamp.'
        });
      }

      if (previous && times.start < previous.end) {
        issues.push({
          severity: 'error',
          line: timestampLine.num,
          title: 'Cue overlaps the previous cue',
          detail: 'Starts at ' + formatSrtTime(times.start) + ' but the previous cue ends at ' + formatSrtTime(previous.end) + '.'
        });
      }

      if (duration > 0 && duration < 0.8) {
        issues.push({
          severity: 'warning',
          line: timestampLine.num,
          title: 'Very short cue',
          detail: 'Only ' + duration.toFixed(2) + ' seconds on screen; viewers may miss it.'
        });
      }

      if (cps > 20) {
        issues.push({
          severity: 'error',
          line: timestampLine.num,
          title: 'Reading speed is too high',
          detail: cps.toFixed(1) + ' characters per second exceeds the 20 chars/s ceiling. Shorten the text or extend the cue.'
        });
      } else if (cps > 17) {
        issues.push({
          severity: 'warning',
          line: timestampLine.num,
          title: 'Reading speed is above comfort range',
          detail: cps.toFixed(1) + ' characters per second. Around 17 chars/s is a useful limit for quick captions.'
        });
      }

      if (longestLine > 52) {
        issues.push({
          severity: 'error',
          line: timestampLine.num,
          title: 'Line is very long',
          detail: longestLine + ' characters in one line. Split it into two shorter lines.'
        });
      } else if (longestLine > 42) {
        issues.push({
          severity: 'warning',
          line: timestampLine.num,
          title: 'Long line detected',
          detail: longestLine + ' characters. Around 42 characters per line is easier to scan on a phone.'
        });
      }

      if (textLines.length > 2) {
        issues.push({
          severity: 'warning',
          line: timestampLine.num,
          title: 'Too many lines in one cue',
          detail: textLines.length + ' lines found. Two lines or fewer usually read better on a small screen.'
        });
      }

      cues.push({
        number: unnumbered,
        line: timestampLine.num,
        start: times.start,
        end: times.end,
        text: textLines.join('\n'),
        lines: textLines,
        duration: duration,
        characters: characters,
        cps: cps,
        wpm: duration > 0 ? (characters / 5) / (duration / 60) : 0
      });
      previous = cues[cues.length - 1];
    });

    return finalizeSrt(cues, issues);
  }

  function finalizeSrt(cues, issues) {
    var peakCps = cues.reduce(function (max, cue) {
      return Math.max(max, cue.cps);
    }, 0);
    return {
      cues: cues,
      issues: issues,
      stats: {
        cues: cues.length,
        errors: issues.filter(function (issue) { return issue.severity === 'error'; }).length,
        warnings: issues.filter(function (issue) { return issue.severity === 'warning'; }).length,
        peakCps: Math.round(peakCps * 10) / 10,
        duration: cues.length ? cues[cues.length - 1].end : 0
      }
    };
  }

  function evaluateMedia(info, platform) {
    var checks = [];
    var width = Number(info.width);
    var height = Number(info.height);
    var size = Number(info.size);
    var ratio = width && height ? width / height : 0;
    var shortEdge = Math.min(width, height);

    if (!width || !height) {
      checks.push({ level: 'bad', text: 'Dimensions could not be read from this file.' });
      return checks;
    }

    if (width < height) {
      checks.push({ level: 'good', text: 'Vertical frame — the natural shape for short-form feeds.' });
    } else if (width === height) {
      checks.push({ level: 'warn', text: 'Square frame. Tall platforms may crop or letterbox it.' });
    } else {
      checks.push({ level: 'bad', text: 'Landscape frame. Export a vertical 9:16 version for best results.' });
    }

    var ratioDiff = Math.abs(ratio - 9 / 16) / (9 / 16);
    if (ratioDiff <= 0.02) {
      checks.push({ level: 'good', text: 'Aspect ratio matches 9:16 within a small tolerance.' });
    } else if (ratioDiff <= 0.08) {
      checks.push({ level: 'warn', text: 'Close to 9:16 but not exact. Minor cropping may occur.' });
    } else {
      checks.push({ level: 'bad', text: 'Aspect ratio is far from 9:16. Expect visible cropping or empty bars.' });
    }

    if (shortEdge >= 720) {
      checks.push({ level: 'good', text: 'Resolution has at least 720 pixels on the short edge.' });
    } else if (shortEdge >= 540) {
      checks.push({ level: 'warn', text: 'Short edge below 720px. It may look soft on high-density screens.' });
    } else {
      checks.push({ level: 'bad', text: 'Very low resolution. Use a taller, higher-resolution export.' });
    }

    if (info.kind === 'video' && info.duration !== null && info.duration !== undefined) {
      if (info.duration <= 60) {
        checks.push({ level: 'good', text: 'Duration is within the common short-form range.' });
      } else if (info.duration <= 180) {
        checks.push({ level: 'warn', text: 'Longer than a minute. Check the current duration limit for ' + (PLATFORM_LABELS[platform] || 'your platform') + '.' });
      } else {
        checks.push({ level: 'warn', text: 'Long clip. Confirm the current upload limit before publishing.' });
      }
    } else if (info.kind === 'image') {
      checks.push({ level: 'good', text: 'Image loaded. Duration checks do not apply.' });
    } else {
      checks.push({ level: 'warn', text: 'Duration is unavailable in this browser. Try another supported format.' });
    }

    if (size === 0) {
      checks.push({ level: 'bad', text: 'This file is empty (0 bytes).' });
    } else if (size <= 100 * 1024 * 1024) {
      checks.push({ level: 'good', text: 'File size is modest and easy to work with.' });
    } else if (size <= 500 * 1024 * 1024) {
      checks.push({ level: 'warn', text: 'Large file. Local preview may be slower and upload limits vary.' });
    } else {
      checks.push({ level: 'bad', text: 'Very large file. Consider a shorter or compressed export.' });
    }

    return checks;
  }

  function drawOverlay(ctx, options) {
    var width = Number(options.width);
    var height = Number(options.height);
    var area = options.area || SAFE_AREAS.tiktok;
    var labels = options.labels !== false;
    var top = Math.round(height * area.top);
    var bottom = Math.round(height * area.bottom);
    var right = Math.round(width * area.right);
    var left = Math.round(width * area.left);
    var lineWidth = Math.max(2, Math.round(width * 0.002));

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(251, 113, 133, 0.32)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = lineWidth;

    var rectangles = [
      { x: 0, y: 0, w: width, h: top, label: 'TOP UI' },
      { x: 0, y: height - bottom, w: width, h: bottom, label: 'BOTTOM UI' },
      { x: width - right, y: top, w: right, h: height - top - bottom, label: 'BUTTONS' },
      { x: 0, y: top, w: left, h: height - top - bottom, label: 'EDGE' }
    ];

    rectangles.forEach(function (rect) {
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      if (ctx.setLineDash) ctx.setLineDash([Math.max(8, width * 0.01), Math.max(6, width * 0.008)]);
      ctx.strokeRect(rect.x + lineWidth / 2, rect.y + lineWidth / 2, Math.max(0, rect.w - lineWidth), Math.max(0, rect.h - lineWidth));
      if (ctx.setLineDash) ctx.setLineDash([]);
    });

    if (labels) {
      var fontSize = Math.max(14, Math.round(width * 0.026));
      ctx.font = '700 ' + fontSize + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      rectangles.forEach(function (rect) {
        if (rect.w < fontSize * 3 || rect.h < fontSize * 1.4) return;
        var textWidth = ctx.measureText ? ctx.measureText(rect.label).width : rect.label.length * fontSize * 0.6;
        var badgeW = Math.min(rect.w - lineWidth * 2, textWidth + fontSize);
        var badgeH = Math.min(rect.h - lineWidth * 2, fontSize * 1.7);
        if (badgeW <= 0 || badgeH <= 0) return;
        var cx = rect.x + rect.w / 2;
        var cy = rect.y + rect.h / 2;
        ctx.fillStyle = 'rgba(7, 11, 20, 0.78)';
        ctx.fillRect(cx - badgeW / 2, cy - badgeH / 2, badgeW, badgeH);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(rect.label, cx, cy);
      });
    }

    return rectangles;
  }

  var api = {
    SAFE_AREAS: SAFE_AREAS,
    PLATFORM_LABELS: PLATFORM_LABELS,
    formatBytes: formatBytes,
    formatDuration: formatDuration,
    formatSrtTime: formatSrtTime,
    simplifyRatio: simplifyRatio,
    parseTimestampLine: parseTimestampLine,
    parseSrt: parseSrt,
    evaluateMedia: evaluateMedia,
    drawOverlay: drawOverlay
  };

  global.ClipCheck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  function init() {
    var byId = function (id) { return document.getElementById(id); };
    var mediaFile = byId('mediaFile');
    var dropZone = byId('dropZone');
    var fileError = byId('fileError');
    var fileMeta = byId('fileMeta');
    var metaName = byId('metaName');
    var metaType = byId('metaType');
    var metaSize = byId('metaSize');
    var clearMediaBtn = byId('clearMedia');
    var overlayToggle = byId('overlayToggle');
    var previewStage = byId('previewStage');
    var mediaMount = byId('mediaMount');
    var placeholder = byId('previewPlaceholder');
    var overlay = byId('overlay');
    var resultsStatus = byId('resultsStatus');
    var specWidth = byId('specWidth');
    var specHeight = byId('specHeight');
    var specRatio = byId('specRatio');
    var specDuration = byId('specDuration');
    var specSize = byId('specSize');
    var specKind = byId('specKind');
    var checkList = byId('checkList');
    var exportSize = byId('exportSize');
    var labelToggle = byId('labelToggle');
    var downloadOverlayBtn = byId('downloadOverlay');
    var exportError = byId('exportError');
    var srtInput = byId('srtInput');
    var srtFile = byId('srtFile');
    var srtError = byId('srtError');
    var srtStatus = byId('srtStatus');
    var srtStats = byId('srtStats');
    var statCues = byId('statCues');
    var statErrors = byId('statErrors');
    var statWarnings = byId('statWarnings');
    var statCps = byId('statCps');
    var issueList = byId('issueList');
    var cueDetails = byId('cueDetails');
    var cueTableBody = byId('cueTableBody');

    var state = { url: null, element: null, info: null };
    var originalDownloadText = downloadOverlayBtn.textContent;

    var sampleSrt = [
      '1',
      '00:00:00,000 --> 00:00:03,200',
      'A quick check before you post your next vertical clip.',
      '',
      '2',
      '00:00:03,400 --> 00:00:06,000',
      'Keep faces and captions inside the safe centre.',
      '',
      '3',
      '00:00:06,200 --> 00:00:08,000',
      'This line is intentionally much longer than forty-two characters to show a reading warning.',
      '',
      '4',
      '00:00:09,000 --> 00:00:10,000',
      'Too fast for the time available here!'
    ].join('\n');

    function platform() {
      var selected = document.querySelector('input[name="platform"]:checked');
      return selected ? selected.value : 'tiktok';
    }

    function showError(element, message) {
      element.textContent = message || '';
      element.hidden = !message;
    }

    function setNeutralChecks(message) {
      checkList.textContent = '';
      var item = document.createElement('li');
      item.className = 'check-item check-neutral';
      item.textContent = message;
      checkList.appendChild(item);
    }

    function resetSpecs() {
      [specWidth, specHeight, specRatio, specDuration, specSize, specKind].forEach(function (node) {
        node.textContent = '—';
      });
    }

    function applyArea() {
      var area = SAFE_AREAS[platform()] || SAFE_AREAS.tiktok;
      ['top', 'bottom', 'right', 'left'].forEach(function (key) {
        overlay.style.setProperty('--' + key, (area[key] * 100) + '%');
      });
    }

    function positionStage(width, height) {
      if (!width || !height) return;
      var parentWidth = previewStage.parentElement.clientWidth || 360;
      var maxHeight = Math.max(240, Math.round(window.innerHeight * 0.62));
      var maxWidth = Math.min(parentWidth, 520, maxHeight * width / height);
      previewStage.style.width = Math.max(120, Math.round(maxWidth)) + 'px';
      previewStage.style.maxWidth = '100%';
      previewStage.style.aspectRatio = width + ' / ' + height;
    }

    function updateChecks() {
      if (!state.info) {
        setNeutralChecks('Choose a file to see checks.');
        return;
      }
      checkList.textContent = '';
      evaluateMedia(state.info, platform()).forEach(function (check) {
        var item = document.createElement('li');
        item.className = 'check-item check-' + check.level;
        item.textContent = check.text;
        checkList.appendChild(item);
      });
    }

    function renderSpecs() {
      var info = state.info;
      specWidth.textContent = info.width + ' px';
      specHeight.textContent = info.height + ' px';
      specRatio.textContent = simplifyRatio(info.width, info.height) + ' (' + (info.width / info.height).toFixed(3) + ')';
      specDuration.textContent = info.kind === 'video' ? formatDuration(info.duration) : 'Not applicable (image)';
      specSize.textContent = formatBytes(info.size);
      specKind.textContent = info.kind === 'video' ? 'Video' : 'Image';
    }

    function releaseMedia() {
      if (state.url) URL.revokeObjectURL(state.url);
      if (state.element && state.element.parentNode) state.element.parentNode.removeChild(state.element);
      state.url = null;
      state.element = null;
      state.info = null;
    }

    function mediaError(message) {
      releaseMedia();
      mediaFile.value = '';
      showError(fileError, message);
      placeholder.textContent = 'Preview unavailable — see the message above.';
      placeholder.hidden = false;
      overlay.hidden = true;
      fileMeta.hidden = true;
      clearMediaBtn.disabled = true;
      resultsStatus.textContent = 'Could not read this file.';
      resetSpecs();
      setNeutralChecks('No valid file loaded.');
      previewStage.style.width = '';
      previewStage.style.aspectRatio = '9 / 16';
    }

    function finishLoad(width, height, duration, kind, file) {
      if (!width || !height) {
        mediaError('This file has no readable dimensions. Try a standard image or video format.');
        return;
      }
      state.info = {
        width: width,
        height: height,
        duration: kind === 'video' ? duration : null,
        size: file.size,
        kind: kind,
        name: file.name
      };
      showError(fileError, '');
      metaName.textContent = file.name;
      metaType.textContent = file.type || (kind === 'video' ? 'video (type not reported)' : 'image (type not reported)');
      metaSize.textContent = formatBytes(file.size);
      fileMeta.hidden = false;
      clearMediaBtn.disabled = false;
      placeholder.hidden = true;
      overlay.hidden = !overlayToggle.checked;
      resultsStatus.textContent = 'Local checks complete.';
      renderSpecs();
      updateChecks();
      positionStage(width, height);
    }

    function handleFile(file) {
      if (!file) return;
      var type = (file.type || '').toLowerCase();
      var name = file.name.toLowerCase();
      var kind = null;

      if (type.indexOf('video/') === 0 || /\.(mp4|m4v|webm|mov|ogv|ogg)$/.test(name)) kind = 'video';
      else if (type.indexOf('image/') === 0 || /\.(png|jpe?g|gif|webp|avif|bmp)$/.test(name)) kind = 'image';

      releaseMedia();
      showError(fileError, '');
      mediaFile.value = '';

      if (!kind) {
        mediaError('Unsupported file. Choose a video or image that your browser can play.');
        return;
      }

      placeholder.textContent = 'Reading file locally…';
      placeholder.hidden = false;
      overlay.hidden = true;
      resultsStatus.textContent = 'Reading file locally…';
      resetSpecs();
      setNeutralChecks('Reading file locally…');
      fileMeta.hidden = true;
      clearMediaBtn.disabled = true;

      var url = URL.createObjectURL(file);
      state.url = url;

      if (kind === 'video') {
        var video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.setAttribute('aria-label', 'Preview of ' + file.name);
        state.element = video;
        video.addEventListener('loadedmetadata', function () {
          if (state.url !== url) return;
          finishLoad(video.videoWidth, video.videoHeight, Number.isFinite(video.duration) ? video.duration : null, kind, file);
        });
        video.addEventListener('error', function () {
          if (state.url === url) mediaError('This video could not be decoded locally. Try MP4 (H.264) or WebM.');
        });
        video.src = url;
        mediaMount.appendChild(video);
      } else {
        var image = new Image();
        image.alt = 'Preview of ' + file.name;
        state.element = image;
        image.addEventListener('load', function () {
          if (state.url === url) finishLoad(image.naturalWidth, image.naturalHeight, null, kind, file);
        });
        image.addEventListener('error', function () {
          if (state.url === url) mediaError('This image could not be decoded locally. Try PNG, JPEG or WebP.');
        });
        image.src = url;
        mediaMount.appendChild(image);
      }
    }

    function clearMedia() {
      releaseMedia();
      mediaFile.value = '';
      showError(fileError, '');
      placeholder.textContent = 'Your preview will appear here';
      placeholder.hidden = false;
      overlay.hidden = true;
      fileMeta.hidden = true;
      clearMediaBtn.disabled = true;
      resultsStatus.textContent = 'Waiting for a file.';
      previewStage.style.width = '';
      previewStage.style.aspectRatio = '9 / 16';
      resetSpecs();
      setNeutralChecks('Choose a file to see checks.');
    }

    function renderSrt(result) {
      statCues.textContent = result.stats.cues;
      statErrors.textContent = result.stats.errors;
      statWarnings.textContent = result.stats.warnings;
      statCps.textContent = result.stats.peakCps;
      srtStats.hidden = false;
      srtStatus.textContent = result.stats.cues + ' cues · ' + result.stats.errors + ' errors · ' + result.stats.warnings + ' warnings';

      issueList.textContent = '';
      if (!result.issues.length) {
        var ok = document.createElement('li');
        ok.className = 'issue-item issue-info';
        var okTitle = document.createElement('strong');
        okTitle.textContent = 'No problems found';
        var okDetail = document.createElement('span');
        okDetail.textContent = 'Timing, order and line lengths look comfortable for short-form captions.';
        ok.appendChild(okTitle);
        ok.appendChild(okDetail);
        issueList.appendChild(ok);
      } else {
        result.issues.forEach(function (issue) {
          var item = document.createElement('li');
          item.className = 'issue-item issue-' + issue.severity;
          var title = document.createElement('strong');
          title.textContent = issue.title;
          var detail = document.createElement('span');
          detail.textContent = 'Line ' + issue.line + ' · ' + issue.detail;
          item.appendChild(title);
          item.appendChild(detail);
          issueList.appendChild(item);
        });
      }

      cueTableBody.textContent = '';
      cueDetails.hidden = !result.cues.length;
      result.cues.forEach(function (cue) {
        var longest = cue.lines.reduce(function (max, line) { return Math.max(max, line.length); }, 0);
        var severity = cue.cps > 20 || longest > 52 ? 'is-error' : cue.cps > 17 || longest > 42 || cue.duration < 0.8 ? 'is-warn' : '';
        var row = document.createElement('tr');
        if (severity) row.className = severity;
        var values = [
          cue.number === null ? '—' : cue.number,
          formatSrtTime(cue.start),
          formatSrtTime(cue.end),
          cue.duration.toFixed(2) + ' s',
          cue.cps.toFixed(1),
          cue.text.replace(/\n/g, ' / ')
        ];
        values.forEach(function (value) {
          var cell = document.createElement('td');
          cell.textContent = value;
          row.appendChild(cell);
        });
        cueTableBody.appendChild(row);
      });
    }

    function resetSrt() {
      srtInput.value = '';
      srtFile.value = '';
      showError(srtError, '');
      srtStats.hidden = true;
      srtStatus.textContent = 'No subtitles checked yet.';
      cueDetails.hidden = true;
      cueTableBody.textContent = '';
      issueList.textContent = '';
      var empty = document.createElement('li');
      empty.className = 'issue-empty';
      empty.textContent = 'Run the validator to see findings.';
      issueList.appendChild(empty);
    }

    function validateSrt() {
      var value = srtInput.value;
      if (!value.trim()) {
        showError(srtError, 'Paste SRT text or choose a .srt file first.');
        srtStatus.textContent = 'Nothing to validate yet.';
        srtStats.hidden = true;
        return;
      }
      showError(srtError, '');
      renderSrt(parseSrt(value));
    }

    mediaFile.addEventListener('change', function () {
      handleFile(mediaFile.files && mediaFile.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function (event) {
        event.preventDefault();
        dropZone.classList.add('is-dragging');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function () {
        dropZone.classList.remove('is-dragging');
      });
    });
    dropZone.addEventListener('drop', function (event) {
      event.preventDefault();
      handleFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
    });

    clearMediaBtn.addEventListener('click', clearMedia);
    overlayToggle.addEventListener('change', function () {
      overlay.hidden = !overlayToggle.checked || !state.info;
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="platform"]'), function (radio) {
      radio.addEventListener('change', function () {
        applyArea();
        updateChecks();
      });
    });

    window.addEventListener('resize', function () {
      if (state.info) positionStage(state.info.width, state.info.height);
    });

    downloadOverlayBtn.addEventListener('click', function () {
      showError(exportError, '');
      var dimensions = exportSize.value.split('x');
      var width = Number(dimensions[0]);
      var height = Number(dimensions[1]);
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      if (!ctx) {
        showError(exportError, 'This browser cannot draw the overlay. Try a current version of Chrome, Firefox, Edge or Safari.');
        return;
      }
      var area = SAFE_AREAS[platform()] || SAFE_AREAS.tiktok;
      drawOverlay(ctx, { width: width, height: height, area: area, labels: labelToggle.checked });

      var fileName = 'clipcheck-safearea-' + platform() + '-' + width + 'x' + height + '.png';
      function save(href, revoke) {
        var link = document.createElement('a');
        link.href = href;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (revoke) setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
        downloadOverlayBtn.textContent = 'Downloaded';
        setTimeout(function () { downloadOverlayBtn.textContent = originalDownloadText; }, 1800);
      }
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (!blob) {
            showError(exportError, 'The PNG could not be created. Please try again.');
            return;
          }
          save(URL.createObjectURL(blob), true);
        }, 'image/png');
      } else {
        save(canvas.toDataURL('image/png'), false);
      }
    });

    byId('sampleSrt').addEventListener('click', function () {
      srtInput.value = sampleSrt;
      showError(srtError, '');
      srtStatus.textContent = 'Sample inserted — click Validate subtitles.';
      srtStats.hidden = true;
    });
    byId('clearSrt').addEventListener('click', resetSrt);
    byId('validateSrt').addEventListener('click', validateSrt);

    srtFile.addEventListener('change', function () {
      var file = srtFile.files && srtFile.files[0];
      if (!file) return;
      file.text().then(function (text) {
        srtInput.value = text;
        showError(srtError, '');
        validateSrt();
      }).catch(function () {
        showError(srtError, 'This subtitle file could not be read as text.');
      });
    });

    applyArea();
    setNeutralChecks('Choose a file to see checks.');
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
