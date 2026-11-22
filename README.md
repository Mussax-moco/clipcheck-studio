# ClipCheck Studio

A free, private browser toolkit for TikTok, Instagram Reels and YouTube Shorts creators. It previews a local video or image, reports dimensions/aspect ratio/duration/file size, draws approximate platform safe-area guides, exports a transparent safe-area PNG, and validates SRT subtitles.

Everything runs in the browser with plain HTML, CSS and vanilla JavaScript. There is no backend, database, paid API, external library, tracking or file upload.

**Live site:** https://mussax-moco.github.io/clipcheck-studio/

## Features

- Local video and image preview with playable controls for video.
- Width, height, simplified and decimal aspect ratio, duration, file size and media type readout.
- Platform guidance for vertical framing, resolution, ratio, duration and size.
- Approximate safe-area overlays for TikTok, Instagram Reels and YouTube Shorts.
- Transparent PNG export of the selected platform guide at 1080×1920, 720×1280 or 2160×3840.
- SRT parsing from pasted text or a `.srt` file, with checks for cue order, timestamps, overlaps, empty cues, reading speed, short cues and long lines.
- Per-cue timing table and plain-language issue messages with line numbers.
- Mobile-first, accessible interface with keyboard focus states and live regions.
- SEO-ready static pages with canonical URLs, Open Graph metadata, structured data, `sitemap.xml` and `robots.txt`.

## Project files

- `index.html` — tools, guides, FAQ, metadata and original explainer copy.
- `about.html` — project background and principles.
- `privacy.html` — privacy policy for local processing and hosting.
- `contact.html` — bug reports, feature requests and contact guidance.
- `styles.css` — responsive theme, layout and overlay styling.
- `app.js` — all client-side logic, including pure functions exposed as `window.ClipCheck`.
- `sitemap.xml` — canonical public URLs for search indexing.
- `robots.txt` — crawl permissions and sitemap reference.
- `tests/test.js` — Node test script for core parsing, checking and export logic.
- `tests/seo-test.js` — Node test script for metadata, links and sitemap consistency.

## Local testing

No install step is required. The simplest option is to open `index.html` directly in a modern browser.

For a more realistic local server, run one of these from the project directory:

```bash
python3 -m http.server 8000
```

or, if Node is available:

```bash
npx serve .
```

Then visit `http://localhost:8000` (or the address printed by `serve`).

Suggested manual checks:

1. Load a portrait MP4. Confirm the preview appears, metadata fills in, and the overlay toggles.
2. Switch platforms and confirm the guide bands and guidance text change.
3. Download a PNG and place it over footage in an editor; the centre should be transparent.
4. Paste SRT text, click **Insert sample**, then **Validate subtitles** to see timing and reading-speed findings.
5. Try an unsupported file and confirm a readable error appears instead of a broken preview.
6. Follow every header and footer link, including About, Privacy, Contact and the sitemap.

Run the automated checks with:

```bash
node --check app.js
node tests/test.js
node tests/seo-test.js
```

## Search indexing

All canonical URLs use the deployed GitHub Pages address exactly. `robots.txt` allows crawling and points to the absolute sitemap URL. Each page has a unique title, meta description, canonical link and Open Graph metadata. The homepage includes a visible FAQ backed by matching `FAQPage` structured data.

When deploying to a different domain, update every canonical, `og:url`, `twitter:title`, sitemap `loc` and the sitemap line in `robots.txt` before requesting indexing.

## Free deployment

This is a static site, so any static host works.

### GitHub Pages

1. Create a GitHub repository and push these files.
2. In the repository, open **Settings → Pages**.
3. Set **Source** to **Deploy from a branch**, choose `main` and `/root`, then save.
4. Open the `https://<username>.github.io/<repository>/` URL shown on the Pages page.

### Netlify

1. Sign in at Netlify and choose **Add new site → Deploy manually**.
2. Drag the project folder onto the upload area.
3. No build command or publish directory override is needed.
4. Optionally add a custom domain under **Site settings → Domain management**.

### Cloudflare Pages

1. In Cloudflare, open **Workers & Pages → Create → Pages → Upload assets**.
2. Upload the project folder and name the project.
3. Deploy; no framework preset or build command is required.

### Vercel

1. Import the GitHub repository into Vercel.
2. Accept the defaults (no build command, output is the repository root).
3. Deploy.

## Privacy and accuracy notes

- Files are read with `URL.createObjectURL` and subtitles are parsed as text in memory. Nothing is fetched or sent anywhere by the application.
- Safe-area percentages are approximate planning guides based on common vertical UI layouts. They are not official measurements, and real placement varies by app version, device and account settings.
- Duration and file-size checks are general guidance. Platform limits change; check the platform's own help centre before publishing.
- ClipCheck Studio is an independent tool and is not affiliated with, endorsed by or connected to TikTok, Instagram, YouTube or their parent companies.
