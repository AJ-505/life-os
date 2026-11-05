import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/design-system/ui/select'

import { NO_PROJECT_ID } from '../types'
import { pickProject } from './calendar-logic'

import type { ProjectWithTasks } from '../types'

function Swatch({ color }: { color: string | undefined }) {
  return color ? (
    <span data-proj={color} className="size-2 shrink-0 rounded-full bg-proj" />
  ) : (
    <span className="size-2 shrink-0 rounded-full border border-muted-foreground/60" />
  )
}

export function ProjectPicker({
  projects,
  chosen,
  onChange,
}: {
  projects: Array<ProjectWithTasks>
  chosen: string | null
  onChange: (id: string) => void
}) {
  const value = pickProject(chosen, projects)
  const project = projects.find((p) => p.id === value)

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className="min-w-0 flex-1 text-xs"
        aria-label="Project"
      >
        <SelectValue>
          <span className="flex min-w-0 items-center gap-1.5">
            <Swatch color={project?.color} />
            <span className="truncate">{project?.name ?? 'No project'}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PROJECT_ID}>
          <span className="flex items-center gap-1.5">
            <Swatch color={undefined} />
            No project
          </span>
        </SelectItem>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex items-center gap-1.5">
              <Swatch color={p.color} />
              {p.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
