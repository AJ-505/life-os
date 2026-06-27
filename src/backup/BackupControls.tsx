import { useRef, useState } from 'react'
import { useConvex } from 'convex/react'
import { useConvexMutation } from '@convex-dev/react-query'
import { HardDriveDownload, HardDriveUpload } from 'lucide-react'

import { api } from '../../convex/_generated/api'
import { Button } from '#/design-system/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/design-system/ui/dialog'

import type { BackupFile } from './types'

export function BackupControls() {
  const convex = useConvex()
  const importBackup = useConvexMutation(api.backup.importBackup)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    const data = await convex.query(api.backup.exportBackup, {})
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lifeos-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFile = async (file: File) => {
    setError(null)
    try {
      const parsed = JSON.parse(await file.text()) as Partial<BackupFile>
      if (parsed.app !== 'lifeos' || !parsed.projects || !parsed.tasks) {
        throw new Error('bad file')
      }
      setPendingImport(parsed as BackupFile)
    } catch {
      setError('That file is not a LifeOS backup.')
    }
  }

  const confirmImport = async () => {
    if (!pendingImport) return
    setBusy(true)
    try {
      // Convex reactivity pushes the restored board to every open tab — no
      // manual cache invalidation needed.
      await importBackup(pendingImport)
      setPendingImport(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="os-label px-2">Data</span>
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2"
        onClick={handleExport}
      >
        <HardDriveDownload className="size-4" /> Export backup
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2"
        onClick={() => fileRef.current?.click()}
      >
        <HardDriveUpload className="size-4" /> Import backup
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
          e.target.value = ''
        }}
      />
      {error ? <p className="px-2 text-xs text-destructive">{error}</p> : null}

      <Dialog
        open={pendingImport !== null}
        onOpenChange={(open) => !open && setPendingImport(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace everything?</DialogTitle>
            <DialogDescription>
              Importing this backup will erase your current board and restore{' '}
              {pendingImport?.projects.length ?? 0} projects and{' '}
              {pendingImport?.tasks.length ?? 0} tasks from{' '}
              {pendingImport
                ? new Date(pendingImport.exportedAt).toLocaleString()
                : ''}
              . This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingImport(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={confirmImport}
            >
              {busy ? 'Importing…' : 'Replace my data'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
