# Skill: add-doc

Add a new documentation file to the `docs/` folder in the right location,
with correct formatting and cross-links to related docs.

## Usage

Invoke this skill with:

- topic area: `getting-started`, `architecture`, `notebook`, `components`, or a new folder name
- file name (kebab-case, e.g. `markdown-cells`)
- content to document

## Folder guide

| Topic                    | Folder                  | Examples                                      |
| ------------------------ | ----------------------- | --------------------------------------------- |
| Onboarding, setup        | `docs/getting-started/` | installation, running, env vars               |
| Code structure, patterns | `docs/architecture/`    | folder layout, state management, API patterns |
| Notebook features        | `docs/notebook/`        | cell types, execution, persistence            |
| UI components            | `docs/components/`      | shadcn reference, custom component API        |
| AI agents, skills        | `docs/agents/`          | agent concepts, SDK usage, skill reference    |
| Everything else          | new folder              | create a new topic folder                     |

## Steps

### 1. Create the file

```
docs/{topic}/{file-name}.md
```

### 2. Use this structure

```markdown
# Title

One sentence explaining what this doc covers and who it's for.

---

## Section heading

Content. Use code blocks for all commands and code snippets.

---

## Another section

Keep sections focused — one concept per section.

---

## Related docs

- [Related topic](../other-folder/other-file.md)
```

### 3. Cross-link from related docs

Find docs that cover adjacent topics and add a link to the new file.
Look for a "Related docs" or "Next step" section at the bottom.

### 4. Update contributing.md

Add the new file to the **Docs index** table in `docs/contributing.md`:

```markdown
| {Topic} | `docs/{topic}/{file-name}.md` · ... |
```

## Formatting rules

- **H1** (`#`) — one per file, matches the filename concept
- **H2** (`##`) — major sections, separated by `---` horizontal rules
- **H3** (`###`) — subsections within a major section
- Code blocks always specify the language: ` ```tsx `, ` ```bash `, ` ```ts `
- Tables for reference data (props, routes, commands)
- Relative paths for all internal links: `../architecture/routing.md`

## Checklist

- [ ] File created in the correct `docs/` subfolder
- [ ] H1 title matches the concept (not the filename)
- [ ] All code snippets have language identifiers
- [ ] At least one cross-link to a related doc
- [ ] Entry added to the docs index in `docs/contributing.md`
