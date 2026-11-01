import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '#/design-system/ui/select'
import type { useSpaceMembers } from '../queries'

export type SpaceMember = NonNullable<
  ReturnType<typeof useSpaceMembers>
>[number]

function InitialsDisc({ initials }: { initials: string | null }) {
  if (initials === null || initials === 'ME') {
    return (
      <span className="size-5 shrink-0 rounded-full border border-dashed" />
    )
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-signal text-[9px] font-bold text-signal-foreground">
      {initials}
    </span>
  )
}

export function AssigneeSelect({
  assigneeId,
  members,
  onAssign,
}: {
  assigneeId: string | null
  members: SpaceMember[] | undefined
  onAssign: (assigneeId: string | null) => void
}) {
  const assignee = members?.find((m) => m.userId === assigneeId) ?? null
  return (
    <Select
      value={assigneeId ?? 'unassigned'}
      onValueChange={(value) => onAssign(value === 'unassigned' ? null : value)}
    >
      <SelectTrigger size="sm" className="w-full text-xs">
        {}
        <SelectValue>
          <InitialsDisc initials={assignee?.initials ?? null} />
          {assignee?.name ?? (assigneeId === null ? 'Unassigned' : 'Member')}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          value="unassigned"
          textValue="Unassigned"
          className="text-muted-foreground"
        >
          Unassigned
        </SelectItem>
        <SelectSeparator />
        {(members ?? []).map((member) => (
          <SelectItem
            key={member.userId}
            value={member.userId}
            textValue={member.name}
          >
            <InitialsDisc initials={member.initials} />
            {member.isSelf ? `${member.name} (you)` : member.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
