import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
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
