# Qalam Studio site

The landing page for Qalam Studio: a separate Next.js app, deployed on its own. The studio itself
never runs here.

```bash
cd site
pnpm install
pnpm dev        # http://localhost:3202 (redirects to /en or /ar)
pnpm build
```

- `/en` and `/ar` are both prerendered. `/` redirects by `Accept-Language` (`proxy.ts`).
- All copy lives in `content/en.ts` and `content/ar.ts` (same shape, typed).
- Scroll scenes: `components/sections/*`. Each scene is a tall section with a sticky stage; its
  timeline is built in normalised time (0 → 1) by `components/motion/useScene.ts`.
- Motion is GSAP (ScrollTrigger, SplitText, Flip, CustomEase) with Lenis for wheel smoothing. With
  reduced motion there's no smoothing, no tall scenes, and every scene shows its final state.

## Deploy

On Vercel, create a project from this repo with **Root Directory** set to `site`, and set
`NEXT_PUBLIC_SITE_URL` to the site's public URL (used for canonical links, the sitemap and
robots.txt).

Fonts: Cubit Sans and Cubit Mono (OFL, licences in `app/fonts`), IBM Plex Sans Arabic (OFL,
subset to Arabic + Latin).

Arabic text uses **Thmanyah Sans** when its files are present. Its licence forbids redistributing
the files, so they are gitignored and never committed: download the family from thmanyah.com and
copy `thmanyahsans-Regular.woff2`, `-Medium.woff2` and `-Bold.woff2` into `public/fonts/thmanyah/`.
Without them (a fresh clone, or a deploy built from GitHub) Arabic falls back to IBM Plex Sans Arabic.
