import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  plugins: [
    // Dev tools ship no bytes to production; `command === 'serve'` keeps the
    // plugin out of the build graph entirely.
    command === 'serve' ? devtools() : undefined,
    tailwindcss(),
    tanstackStart(),
    command === 'build' ? nitro() : undefined,
    // React Compiler auto-memoizes components/hooks at build time, so we don't
    // hand-write memo/useMemo/useCallback to keep the board fast under load.
    // Native Rust compiler via oxc-transform-react (no Babel chain).
    viteReact({ compiler: { target: '19' } }),
  ],
}))

export default config
