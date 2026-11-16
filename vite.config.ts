import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const productionBuildId =
  process.env.APP_BUILD_ID ??
  (process.env.VERCEL_ENV === 'production'
    ? process.env.VERCEL_GIT_COMMIT_SHA
    : undefined) ??
  ''

const config = defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(productionBuildId),
  },
  plugins: [
    command === 'serve'
      ? devtools({ consolePiping: { enabled: false } })
      : undefined,
    tailwindcss(),
    tanstackStart(),
    command === 'build' ? nitro() : undefined,
    viteReact({ compiler: { target: '19' } }),
  ],
}))

export default config
