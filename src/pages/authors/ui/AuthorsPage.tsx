import { ExternalLink, GraduationCap } from 'lucide-react'

// The team roster. Roles rotated every sprint (each member wore several hats —
// Tech Lead, DevOps, QA, Engineer #1–5 were reassigned per sprint brief), so a
// member's line names their most visible contribution, not a fixed title.
const TEAM = [
  {
    name: 'Siarhei Luskanau',
    github: 'siarhei-luskanau',
    contribution:
      'Set up the initial CI/CD foundation (GitHub Actions, Dependabot, PR workflows) and moved per-module CI into the submodule repos; authored the system architecture documentation and Sprint 3 cost analysis.',
  },
  {
    name: 'Grigorii Averkin',
    github: 'Computer-God',
    contribution:
      'Set up the QA process in Sprint 1: quality strategy, bug-report template, acceptance criteria, and qa-plan.md. Could not continue due to personal circumstances.',
  },
  {
    name: 'Irina Pukhkaia',
    github: 'IrinaSer',
    contribution:
      'Built the frontend OTP/JWT auth flow and the backend OTP email delivery via Resend; created the project-level AI agent skills; and wrote 40 automated test cases for LLM code generation.',
  },
  {
    name: 'Larisa Morozhnikova',
    github: 'lmoroz',
    contribution:
      'Built the frontend from the ground up and aligned the FE/BE contract with the backend team; led notebook engineering across all sprints: code execution UX (QuickJS), IndexedDB persistence, full UI redesign, background remote sync, and the dashboard startup screen; Sprint 2 Tech Lead (AI generation pipeline design).',
  },
  {
    name: 'Akzhol',
    github: 'aokzhl',
    contribution:
      'Built the cloud-native AWS stack (ECS Fargate, RDS, S3/CloudFront, Terraform) and per-PR preview environments; set up the Liquibase migration runner and Bedrock VPC infrastructure; also refactored the frontend architecture (OpenAPI codegen, shared/api facade, routing).',
  },
  {
    name: 'Oleg',
    github: 'okoleg',
    contribution:
      'Created the initial frontend scaffold (React + Vite + shadcn/ui) with the first notebook execution prototype; built the full cloud LLM generation flow (Bedrock API, Ask agent dialog, LLM playground); authored 82 manual QA test cases and implemented CloudWatch analytics.',
  },
  {
    name: 'Marat Gainutdinov',
    github: 'MaratGaZa',
    contribution:
      'Sprint 1 DevOps — Docker containerization and the initial CI/CD pipeline; built the backend from scratch (API contracts, domain model) and aligned the BE/FE contract with the frontend team; implemented the auth system (OTP + JWT, refresh tokens) and the LLM generation pipeline (Amazon Bedrock); added notebook export and security hardening (OTP rate limiting, prompt-injection guard).',
  },
  {
    name: 'Yuriy Bugakov',
    github: 'SvyatoKod',
    contribution:
      'Tech Lead in early sprints (execution architecture, docs); built the backend foundation from scratch and the auth module; AI context persistence; QA autotest framework (Playwright + pytest + Allure); and contributed to the frontend AI context builder.',
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
        Eight people worked actively across three repositories — monorepo, API and UI.
      </p>
    </div>
  )
}
