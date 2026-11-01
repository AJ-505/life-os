const FALLBACK_SITE_URL = 'https://lifeos-track.vercel.app'

export const SITE_URL = (
  import.meta.env.VITE_SITE_URL || FALLBACK_SITE_URL
).replace(/\/+$/, '')

export const SITE_NAME = 'Life OS'

const TAGLINE = 'Everything, in one place.'
const DESCRIPTION =
  'Projects, tasks, deadlines and focus — without juggling five different apps.'

const OG_IMAGE_PATH = '/og.png'
const OG_IMAGE_WIDTH = 1200
const OG_IMAGE_HEIGHT = 630

export type PageSeo = {
  title: string
  description: string
  noindex?: boolean
}

const DEFAULT_PAGE: PageSeo = {
  title: SITE_NAME,
  description: DESCRIPTION,
}

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
