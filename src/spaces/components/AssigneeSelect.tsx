import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '#/design-system/ui/select'
import type { useSpaceMembers } from '../queries'

/** A space member as `getSpaceMembers` returns one, derived from the query
 *  hook so a change to the server shape cannot drift from this file. */
export type SpaceMember = NonNullable<
  ReturnType<typeof useSpaceMembers>
>[number]

/** The disc for a member, in the trigger and in the list. `null` means there
 *  is no member to name: the task is unassigned, or the id has no match yet.
 *  The server derives the letters (see `member.initials`), and a nameless
 *  member carries the sentinel "ME", which reads as a self-reference. Both
 *  render as a dashed neutral circle. */
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

/** The assignee picker for a space task. `members` arrives as a prop; the
 *  parent already subscribes to `getSpaceMembers`, so the list is normally
 *  populated before the panel opens. A value with no matching member (still
 *  loading, or a member who left) reads as a neutral "Member", never the wrong
 *  name. */
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
        {/* Bare <SelectValue /> echoes the selected item's own text (rule
            stated in full on the Project select in TaskDetails.tsx): blank
            when the value has no matching item. We pass the name in so a
            departed member still reads, and the disc to match the list. */}
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
