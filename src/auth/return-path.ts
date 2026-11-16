import * as z from 'zod'

export const RETURN_PATH = 'redirect'

export const ssoCallbackSearch = z.object({
  [RETURN_PATH]: z
    .string()
    .max(2048)
    .refine(
      (raw) =>
        raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\'),
      { message: 'must be a path on this origin' },
    )
    .optional()
    .catch(undefined),
})
