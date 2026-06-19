/**
 * trello-migrate — Import Trello board data into LifeOS
 *
 * Usage:
 *   pnpm trello:migrate          # run migration
 *   pnpm trello:migrate -- --dry # preview without writing
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import * as schema from '../src/tracker/schema'

config({ path: ['.env.local', '.env'] })

const db = drizzle(process.env.DATABASE_URL!, { schema })
const DRY = process.argv.includes('--dry')

// Trello board data extracted from screenshots
const trelloData = {
  // Inbox items → will be marked as inFocus
  inbox: [
    'Understand how that crazy animation and requestAnimationFrame stuff for the testimonial works',
  ],

  // Lists → Projects with their cards → Tasks
  lists: [
    {
      name: "Today's Learnings",
      color: 'sky',
      cards: [
        "Look into tailwind's --icon-feature (for doing dynamic icons with auto tooltips)",
        "Learnt that in ts v7 the type packages from node_modules don't get auto-loaded but instead you have to define them explicitly in the 'types' field in tsconfig.json",
        'Learnt a ton about philosophy - fallacies, syllogisms, general rules of correct reasoning and how to spot flawed reasoning',
        'About debuggers, the debug adapter protocol (DAP), vscode-js-debug (legendary)',
      ],
    },
    {
      name: 'Goals',
      color: 'iris',
      cards: [
        'Be 100% prepared for Mathematics',
        'Prepare presentation slides for EY Interview',
        'Complete Graphics Assignment',
        'COS remaining group deliverables - team role, presentation slide, live project link',
        'Get massive Archive features merged and ensure they work in prod, stepping in to fix any issues that arise',
      ],
    },
    {
      name: 'Done for Today',
      color: 'moss',
      cards: [],
    },
    {
      name: 'PAU Inventory',
      color: 'saffron',
      cards: [
        'Make location be undefined and be enforced to be chosen before the book laptop button can be clicked',
        'Understand every single part of the system and how it works underneath',
      ],
    },
    {
      name: 'Botnova',
      color: 'orchid',
      cards: [],
    },
    {
      name: 'Internships',
      color: 'sea',
      cards: [
        'Get a PR merged into Next.js',
        'Contribute to Nixpacks (Railway)',
        'Apply for at least 20 out of the 100 companies with the AI-native internship discovery study and send 10 cold emails',
        'DM railway',
        'DM Vercel',
        'DM Paystack',
        'DM Moniepoint',
      ],
    },
    {
      name: 'Academic',
      color: 'flame',
      cards: [],
    },
    {
      name: 'Programming Skill Building',
      color: 'rose',
      cards: [
        '50 times, generate horrendous messy AI generated React code with state messed up all around, let it be very, very diverse in nature, then refactor it, keep the functionality the same, complexities varying, the things that should be looked at should vary (it should touch different parts of component design such as colocation, composition, etc), also with useEffects too → do 50 of those exercises until you absolutely master the art of designing small and well-architected React components, then tell AI to assess my performance',
      ],
    },
    {
      name: 'Fable 5 Tasks',
      color: 'clay',
      cards: [
        'Dramatically, with verified proof, improve the recommendation algorithm of School Pathfinder',
        "Use shadcn's /improve to improve the codebase of the CreditGo, clean everything up, also do the UI passes/fixes (poor button hover states, when you click a button it doesn't respond immediately etc)",
        'Give it the entire Archive backlog and have it grind through each individual task and create a draft PR for each fix/update/improvement',
      ],
    },
    {
      name: 'Weekly Goals',
      color: 'slate',
      cards: ['Secure an internship', 'Upgrade to Ubuntu 26.04'],
    },
    {
      name: 'Yankee Stores',
      color: 'iris',
      cards: ['BLOCKED:'],
    },
    {
      name: 'Jobs Applied For',
      color: 'moss',
      cards: [
        'HitchPay',
        'Ernst & Young - GOT BACK',
        'Equinix',
        'Bank of America',
        'Stanbic IBTC',
        'Cluely',
        'Praxigen',
      ],
    },
    {
      name: 'OSS',
      color: 'sea',
      cards: [],
    },
  ],
}

const POSITION_GAP = 1024

function positionAt(index: number): number {
  return (index + 1) * POSITION_GAP
}

async function main() {
  console.log(`trello-migrate${DRY ? '  (dry run)' : ''}\n`)

  // Track inbox task IDs to mark as focus later
  const inboxTaskIds: string[] = []

  // Create projects and tasks
  for (let colIdx = 0; colIdx < trelloData.lists.length; colIdx++) {
    const list = trelloData.lists[colIdx]
    console.log(`▸ ${list.name} (${list.cards.length} cards)`)

    if (DRY) {
      console.log(`  would create project at col=${colIdx}`)
      for (const card of list.cards) {
        console.log(`    - ${card.slice(0, 60)}${card.length > 60 ? '...' : ''}`)
      }
      continue
    }

    // Create project
    const [project] = await db
      .insert(schema.projects)
      .values({
        name: list.name,
        color: list.color,
        gridCol: colIdx,
        gridRow: positionAt(0),
        status: 'active',
      })
      .returning()

    // Create tasks
    for (let i = 0; i < list.cards.length; i++) {
      const [task] = await db
        .insert(schema.tasks)
        .values({
          projectId: project.id,
          title: list.cards[i],
          position: positionAt(i),
          done: false,
        })
        .returning()

      console.log(`  ✓ ${list.cards[i].slice(0, 50)}${list.cards[i].length > 50 ? '...' : ''}`)
    }
  }

  // Create Inbox project for focus items
  if (trelloData.inbox.length > 0) {
    console.log(`\n▸ Inbox (→ Focus)`)

    if (!DRY) {
      const [inboxProject] = await db
        .insert(schema.projects)
        .values({
          name: 'Inbox',
          color: 'saffron',
          gridCol: trelloData.lists.length,
          gridRow: positionAt(0),
          status: 'active',
        })
        .returning()

      for (let i = 0; i < trelloData.inbox.length; i++) {
        const [task] = await db
          .insert(schema.tasks)
          .values({
            projectId: inboxProject.id,
            title: trelloData.inbox[i],
            position: positionAt(i),
            done: false,
            inFocus: true,
            focusOrder: positionAt(i),
          })
          .returning()

        inboxTaskIds.push(task.id)
        console.log(`  ✓ ${trelloData.inbox[i].slice(0, 50)}...`)
      }
    } else {
      console.log(`  would create Inbox project with ${trelloData.inbox.length} focus items`)
    }
  }

  console.log(`\nDone! ${DRY ? 'Preview complete.' : `Imported ${trelloData.lists.length} projects with ${trelloData.lists.reduce((n, l) => n + l.cards.length, 0)} tasks.`}`)
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`)
  process.exit(1)
})
