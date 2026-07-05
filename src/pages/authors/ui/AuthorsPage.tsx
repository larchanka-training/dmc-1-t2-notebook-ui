import { ExternalLink, GraduationCap } from 'lucide-react'

// The team roster. Roles rotated every sprint (each member wore several hats —
// Tech Lead, DevOps, QA, Engineer #1–5 were reassigned per sprint brief), so a
// member's line names their most visible contribution, not a fixed title.
const TEAM = [
  {
    name: 'Siarhei Luskanau',
    github: 'siarhei-luskanau',
    contribution: 'Frontend lead and main contributor — the notebook core, cells and runtime.',
  },
  {
    name: 'Grigorii Averkin',
    github: 'Computer-God',
    contribution: 'Engineering — backend and QA across sprint rotations.',
  },
  {
    name: 'Irina Ser.',
    github: 'IrinaSer',
    contribution: 'Engineering — QA and test suites across sprint rotations.',
  },
  {
    name: 'Larisa Morozh',
    github: 'lmoroz',
    contribution:
      'Project tooling and agent skills, the English translation of the project docs, and the final presentation.',
  },
  {
    name: 'Akzhol',
    github: 'aokzhl',
    contribution: 'Engineering — backend and CI across sprint rotations.',
  },
  {
    name: 'Oleg',
    github: 'okoleg',
    contribution: 'Engineering — backend and monitoring across sprint rotations.',
  },
  {
    name: 'Marat',
    github: 'MaratGaZa',
    contribution: 'DevOps and infrastructure — CI/CD, cloud deployment and the migration off AWS.',
  },
] as const

function GithubLink({ handle }: { handle: string }) {
  return (
    <a
      href={`https://github.com/${handle}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
    >
      @{handle}
      <ExternalLink className="size-3" />
    </a>
  )
}

function MemberCard({
  name,
  github,
  contribution,
}: {
  name: string
  github: string
  contribution: string
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-card p-[18px]">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{name}</h3>
        <GithubLink handle={github} />
      </div>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">{contribution}</p>
    </div>
  )
}

export default function AuthorsPage() {
  return (
    <div className="mx-auto max-w-[720px] px-6 pt-12 pb-24 sm:px-10">
      {/* hero */}
      <h1 className="mb-1.5 text-[34px] font-semibold tracking-tight">Authors</h1>
      <p className="mb-9 text-[17px] leading-relaxed text-muted-foreground">
        JS Notebook is built by team <span className="font-medium text-foreground">TARDIS T2</span>{' '}
        of the Modern Software Development course. Roles — Tech Lead, DevOps, QA, Engineers — were
        reassigned every sprint, so everyone wore several hats.
      </p>

      {/* mentor */}
      <div className="mb-9 flex items-start gap-3.5 rounded-[var(--radius-card)] border border-border bg-card p-[18px]">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <GraduationCap className="size-[18px]" />
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-semibold">Mikhail Larchanka</h3>
            <GithubLink handle="larchanka" />
          </div>
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            Mentor, ideological inspirer and organizer of the project. Before every sprint he laid
            out the tasks per role — Tech Lead, DevOps, QA, Engineers #1–5 — while leaving the
            implementation entirely to the team.
          </p>
        </div>
      </div>

      {/* team grid */}
      <h2 className="mb-2.5 text-[22px] font-semibold tracking-tight">The team</h2>
      <div className="grid gap-3.5 sm:grid-cols-2">
        {TEAM.map((m) => (
          <MemberCard key={m.github} {...m} />
        ))}
      </div>

      {/* footer note */}
      <p className="mt-12 border-t border-border pt-6 text-[13px] text-muted-foreground">
        Seven people worked actively across three repositories — monorepo, API and UI. The final
        presentation with the full contribution breakdown lives at{' '}
        <a
          href="http://tardis.ubiz.ru"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary hover:underline"
        >
          tardis.ubiz.ru
        </a>
        .
      </p>
    </div>
  )
}
