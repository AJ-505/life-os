/**
 * Social and canonical metadata, in one place.
 *
 * A link is only ever read by someone who is not logged in, so this has to be
 * right on the server: WhatsApp, Slack and iMessage fetch the URL cold, never
 * run the app, and render whatever the `<head>` says. Every tag here is
 * therefore derived from the route alone — no client data, no query.
 *
 * The root route owns the whole set (see `__root.tsx`) rather than letting
 * each route contribute its own tags. Two `og:title` tags is worse than one
 * mediocre one, and a single builder cannot emit a duplicate.
 */

/**
 * Absolute origin for og:url and og:image. Crawlers reject relative image
 * URLs, so this cannot be derived from `location` — there is no location on a
 * cold fetch that we control. Vite inlines it at build time, so changing it
 * needs a rebuild.
 */
const FALLBACK_SITE_URL = 'https://lifeos-track.vercel.app'

export const SITE_URL = (
  import.meta.env.VITE_SITE_URL || FALLBACK_SITE_URL
).replace(/\/+$/, '')

export const SITE_NAME = 'Life OS'

const TAGLINE = 'Everything, in one place.'
const DESCRIPTION =
  'Projects, tasks, deadlines and focus — without juggling five different apps.'

/** 1200x630, rendered from the design tokens and webfonts in `public/og.png`. */
const OG_IMAGE_PATH = '/og.png'
const OG_IMAGE_WIDTH = 1200
const OG_IMAGE_HEIGHT = 630

export type PageSeo = {
  title: string
  description: string
  /** Dynamic, per-user URLs. Crawlers must not build an index from them. */
  noindex?: boolean
}

const DEFAULT_PAGE: PageSeo = {
  title: SITE_NAME,
  description: DESCRIPTION,
}

/**
 * Keyed by route id, which is stable and identical on the server and the
 * client. The invite route is the one that matters most: it is the link a
 * person actually pastes into a chat, and the one a crawler sees first.
 *
 * The space name is deliberately absent. Rendering it would mean a public,
 * unauthenticated Convex read keyed on an invite code — a space's name is
 * its owner's data, and that decision is not ours to make inside an SEO fix.
 */
const BY_ROUTE_ID: Record<string, PageSeo> = {
  '/join/$inviteCode': {
    title: `You're invited to a board — ${SITE_NAME}`,
    description: `You have been invited to a shared board. ${DESCRIPTION}`,
    noindex: true,
  },
  '/space/$spaceId': {
    title: `Shared board — ${SITE_NAME}`,
    description: `A shared board on ${SITE_NAME}. ${DESCRIPTION}`,
    noindex: true,
  },
  '/library': {
    title: `Library — ${SITE_NAME}`,
    description: `Shelf, accomplished and archived work. ${DESCRIPTION}`,
    noindex: true,
  },
  '/timeline': {
    title: `Timeline — ${SITE_NAME}`,
    description: `Overdue, today, this week and later. ${DESCRIPTION}`,
    noindex: true,
  },
  '/spaces': {
    title: `Spaces — ${SITE_NAME}`,
    description: `Shared boards for the people you actually work with.`,
    noindex: true,
  },
}

export function seoForRouteId(routeId: string): PageSeo {
  return BY_ROUTE_ID[routeId] ?? DEFAULT_PAGE
}

type MetaTag =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }
  | { charSet: string }

export function metaFor(page: PageSeo, pathname: string): MetaTag[] {
  const url = `${SITE_URL}${pathname}`
  const image = `${SITE_URL}${OG_IMAGE_PATH}`
  const imageAlt = `${SITE_NAME} — ${TAGLINE}`

  const meta: MetaTag[] = [
    { title: page.title },
    { name: 'description', content: page.description },

    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:title', content: page.title },
    { property: 'og:description', content: page.description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: image },
    { property: 'og:image:type', content: 'image/png' },
    { property: 'og:image:width', content: String(OG_IMAGE_WIDTH) },
    { property: 'og:image:height', content: String(OG_IMAGE_HEIGHT) },
    { property: 'og:image:alt', content: imageAlt },

    // summary_large_image is what makes Slack, iMessage and WhatsApp render
    // the 1200x630 card instead of a postage stamp.
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: page.title },
    { name: 'twitter:description', content: page.description },
    { name: 'twitter:image', content: image },
    { name: 'twitter:image:alt', content: imageAlt },
  ]

  if (page.noindex) {
    meta.push({ name: 'robots', content: 'noindex, nofollow' })
  }

  return meta
}

type LinkTag = { rel: string; href: string; type?: string; sizes?: string }

export function linksFor(pathname: string): LinkTag[] {
  return [
    { rel: 'canonical', href: `${SITE_URL}${pathname}` },
    { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    { rel: 'alternate icon', href: '/favicon.ico' },
    { rel: 'apple-touch-icon', href: '/icon-192.png', sizes: '192x192' },
    { rel: 'manifest', href: '/manifest.json' },
  ]
}
