import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '#/design-system/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/design-system/ui/dialog'
import { Input } from '#/design-system/ui/input'
import { Label } from '#/design-system/ui/label'

import { ColorSwatches } from '../ColorSwatches'
import { useBoardScope } from '../board-scope'
import { useCreateProject } from '../queries'
import { freshColor, newId } from '../types'
import { canvasProjects } from './board-logic'
import { appendProjectRow } from './placement'

import type { CreateProjectArgs } from '../queries'
import type { BoardData } from '../types'

export function NewProjectDialog({
  open,
  onClose,
  gridCol,
  board,
}: {
  open: boolean
  onClose: () => void
  gridCol: number
  board: BoardData
}) {
  const { spaceId } = useBoardScope()
  const createProject = useCreateProject()
  const [name, setName] = useState('')
  const usedColors = canvasProjects(board).map((project) => project.color)
  const [color, setColor] = useState<string>(freshColor(usedColors))

  const create = (args: CreateProjectArgs) => {
    createProject.mutate(args, {
      onError: (e: unknown) => {
        toast.error('Could not create the project', {
          description: e instanceof Error ? e.message : String(e),
          action: { label: 'Retry', onClick: () => create(args) },
        })
      },
    })
  }

  const submit = () => {
    const n = name.trim()
    if (!n) return
    create({
      id: newId(),
      name: n,
      color,
      spaceId,
      gridCol,
      gridRow: appendProjectRow(board, gridCol),
    })
    setName('')
    setColor(freshColor([...usedColors, color]))
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                submit()
              }}
              placeholder="e.g. PAU Archive, Sem 2, Apartment hunt…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Color</Label>
            <ColorSwatches value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
