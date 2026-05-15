import { BookText, Code2, Layers, Rocket, Users } from 'lucide-react'
import { Separator } from '@/shared/ui/separator'

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType
  title: string
  description: string
}) {
  return (
    <div className="flex gap-4 p-4 rounded-xl border bg-card">
      <div className="shrink-0 flex items-center justify-center size-10 rounded-lg bg-primary/10">
        <Icon className="size-5 text-primary" />
      </div>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  )
}

export default function AboutPage() {
  return (
    <div className="p-8 max-w-2xl space-y-10">
      {/* hero */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10">
            <BookText className="size-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">JS Notebook</h1>
            <p className="text-sm text-muted-foreground">
              Interactive JavaScript environment in the browser
            </p>
          </div>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          JS Notebook is a browser-based interactive coding environment — similar in concept to{' '}
          <span className="text-foreground font-medium">Jupyter Notebook</span>, but built for{' '}
          <span className="text-foreground font-medium">JavaScript</span> instead of Python. Write
          code in cells, run them instantly, and see output inline — no server, no setup.
        </p>
      </div>

      <Separator />

      {/* course info */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold">About This Course</h2>
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Group</p>
              <p className="font-semibold text-base">TARDIS T2</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Project</p>
              <p className="font-semibold text-base">JS Notebook</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Type</p>
              <p className="font-medium">Training Course</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Stack</p>
              <p className="font-medium">React · TypeScript · Vite</p>
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* features */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold">What's Inside</h2>
        <div className="flex flex-col gap-3">
          <FeatureCard
            icon={Code2}
            title="Interactive JS Cells"
            description="Write and run JavaScript directly in the browser. console.log output and return values are captured and displayed inline."
          />
          <FeatureCard
            icon={Layers}
            title="Component Showcase"
            description="Live gallery of shadcn/ui components and custom-built components used throughout the project."
          />
          <FeatureCard
            icon={Users}
            title="Auth Example"
            description="A login page demonstrating form layout and shadcn input components — ready to wire up to a real backend."
          />
          <FeatureCard
            icon={Rocket}
            title="Modern Tooling"
            description="Built with Vite, Tailwind CSS v4, shadcn/ui, and Reatom — the same stack used in production apps today."
          />
        </div>
      </div>

      <Separator />

      {/* vs jupyter */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold">JS Notebook vs Jupyter</h2>
        <div className="rounded-xl border overflow-hidden text-sm">
          <div className="grid grid-cols-3 bg-muted/50 px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
            <span>Feature</span>
            <span>Jupyter</span>
            <span>JS Notebook</span>
          </div>
          {[
            ['Language', 'Python', 'JavaScript'],
            ['Runtime', 'Server (kernel)', 'Browser (native)'],
            ['Setup', 'Python + pip install', 'None — open the app'],
            ['Async support', 'Partial', 'Full (async/await)'],
            ['UI framework', 'Classic / Lab', 'React + shadcn/ui'],
          ].map(([feature, jupyter, js]) => (
            <div key={feature} className="grid grid-cols-3 px-4 py-2.5 border-t even:bg-muted/20">
              <span className="text-muted-foreground">{feature}</span>
              <span>{jupyter}</span>
              <span className="text-primary font-medium">{js}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
