# Life OS

Everything, in one place.

Life OS is a place to run your life. Projects, tasks, deadlines, and focus — without juggling five different apps.

Live at **https://lifeos-track.vercel.app**

---

## What it is

Most people split their life across a task app, a calendar, a notes app, and whatever their team uses for collaboration. Life OS keeps it in one board. Private by default, collaborative when you want it to be.

## Board

The board is a grid of projects. Each project has its own colour, its own tasks, and lives in a column you can rearrange by dragging. Tasks drag between projects and reorder inside them.

Inside a task you get notes, subtasks, a due date with a 24-hour time, and the option to move it to another project. Subtasks are simple checkable items. Everything saves as you go.

Keyboard: hover any task and hit `f` to focus it, `e` to open it. `]` toggles the Focus panel, `[` toggles the sidebar.

## Focus

Focus is a second view of your tasks that doesn't move them out of their projects. Hit the crosshair on any task or drag it to the panel on the right. It stays where it was — Focus just holds a reference. Reorder, check off, or clear done items when you're finished. On mobile it slides in as a sheet.

## Timeline

Every dated task shows up in Timeline, grouped so you can scan what's actually urgent:

**Overdue · This hour · Today · Tomorrow · This week · Later**

Project target dates appear there too. You can check tasks off or add them to Focus without leaving the view.

## Library

Where finished things live:

- **Shelf** — projects you've shelved to get them off the board. Restore or finish them later.
- **Accomplished** — finished projects and completed tasks grouped by month.
- **Archived** — tasks you've hidden from a project without deleting them.

No separate archive app. It's all in the sidebar.

## Spaces

Your board is private. When you need to work with others, create a Space. Each Space is a shared board with an invite link at `/join/<code>`. Anyone with the link can join — no member limit. Live sync keeps everyone on the same page.

## Google Calendar

Connect Google Calendar in Settings and dated tasks can push to your calendar. Set a due date and time, pick a reminder (5, 15, 30, or 60 minutes), enable "Add to calendar," and Life OS creates or updates the event. Clear the date and the event is removed. Updates and deletes stay in sync.

## Backup

Export your data as JSON from the sidebar and import it back anytime. The backup is scoped to your account — it only ever contains your projects and tasks.

---

## Running locally

```bash
pnpm dev    # runs Vite + Convex together (via portless)
```

`pnpm dev` starts both the app and `convex dev` in one command. It writes `VITE_CONVEX_URL` to `.env.local` on first run. For auth, set your Clerk issuer on the Convex deployment:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your>.clerk.accounts.dev
```
