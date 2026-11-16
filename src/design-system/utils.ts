import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { toast } from 'sonner'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
