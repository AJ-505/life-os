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

import { backupFile } from './schema'

import type { BackupFile } from './schema'

function importSummary(file: BackupFile) {
  const when = new Date(file.exportedAt).toLocaleString()
  const kept = 'Projects inside a space are not in the file and are left alone.'
  if (!file.goals)
    return `Importing this backup will erase your personal board and restore ${file.projects.length} projects and ${file.tasks.length} tasks from ${when}. ${kept} Your goals are not in this file and are left alone. This cannot be undone.`
  return `Importing this backup will erase your personal board and goals, and restore ${file.projects.length} projects, ${file.tasks.length} tasks and ${file.goals.length} goals from ${when}. ${kept} This cannot be undone.`
}

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
    let obj: unknown
    try {
      obj = JSON.parse(await file.text())
    } catch {
      obj = null
    }
    const parsed = backupFile.safeParse(obj)
    if (!parsed.success) {
      setError('That file is not a LifeOS backup.')
      return
    }
    setPendingImport(parsed.data)
  }

  const confirmImport = async () => {
    if (!pendingImport) return
    setBusy(true)
    try {
      await importBackup(pendingImport)
      setPendingImport(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    }
    setBusy(false)
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
            <DialogTitle>Replace your personal board?</DialogTitle>
            <DialogDescription>
              {pendingImport ? importSummary(pendingImport) : null}
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
