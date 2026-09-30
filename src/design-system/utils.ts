import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { toast } from 'sonner'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Write to the clipboard and confirm it. The toast carries the caller's
 *  wording, so "Link copied" and "Code copied" both stay exact. Rejections
 *  surface as an error toast: silent clipboard failures read as a dead
 *  button. */
export async function copyToClipboard(text: string, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch (e) {
    toast.error('Could not copy', {
      description: e instanceof Error ? e.message : String(e),
    })
  }
}
