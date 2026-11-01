import type { AuthConfig } from 'convex/server'

import { devAuthProviders } from './devAuth'

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: 'convex',
    },
    ...devAuthProviders(),
  ],
} satisfies AuthConfig
