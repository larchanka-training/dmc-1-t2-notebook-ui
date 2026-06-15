# .agents

This folder contains **skill files** — step-by-step instructions for common
tasks in this project. Each file documents a repeating pattern so it never
has to be figured out from scratch again.

Skills are written for AI agents (Claude Code, Cursor, Copilot) and for
humans who want a precise reference.

## Available skills

| File                              | Skill                          | Use when                                                  |
| --------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `add-page.md`                     | Add a new page                 | Need a new route + sidebar entry                          |
| `add-shadcn.md`                   | Install a shadcn component     | Adding a UI primitive from shadcn registry                |
| `add-custom-component.md`         | Create a custom component      | Building a new reusable component                         |
| `add-doc.md`                      | Write a new doc                | Documenting a new feature or concept                      |
| `add-endpoint.md`                 | Add an HTTP endpoint           | Wiring a new backend call into the facade                 |
| `fix-shadcn-placement.md`         | Fix shadcn file location       | After any `shadcn add` command                            |
| `implement-cloud-llm-generate.md` | Wire cloud LLM code generation | Implementing the Cloud button → `POST /llm/generate` flow |

## How to use

**With Claude Code:** paste the skill content into the conversation or reference
the file and ask Claude to follow it for a specific input.

**Manually:** read the checklist and follow the steps in order.

## How to add a new skill

1. Identify a task you've done more than twice
2. Create `{verb}-{noun}.md` in this folder
3. Follow this structure:

```markdown
# Skill: name

One sentence: what does this skill do and when is it used.

## Usage

What inputs does it need?

## Steps

### 1. Step title

Exact commands or code to run/write.

## Checklist

- [ ] Verifiable completion criterion
```

4. Add it to the table in this README
