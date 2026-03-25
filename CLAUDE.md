# Aethra — Claude Code Quick Reference

> For full documentation see **[AGENTS.md](./AGENTS.md)**.

## Stack

- **React 18** + **Vite 6** + **TypeScript 5** (strict)
- **Custom CSS only** — no framework, all variables in `src/styles/global.css`

## Run / Build

```bash
npm install      # install dependencies (first time)
npm run dev      # start dev server (user runs this)
npm run build    # production build (user runs this)
```

> Do **not** run `npm run dev` or `npm run build` autonomously.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/index.ts` | All shared TypeScript types |
| `src/App.tsx` | Root component & state |
| `src/components/Sidebar.tsx` | Left panel — scene list |
| `src/components/ChatArea.tsx` | Centre panel — message feed |
| `src/components/InputBar.tsx` | Centre panel — composer |
| `src/components/DetailsPanel.tsx` | Right panel — details |
| `src/styles/global.css` | CSS variables & reset |
| `src/styles/layout.css` | Three-column layout |
| `.env.example` | LLM config template |

## Coding Rules

1. **Header comment** on every file describing its purpose.
2. **JSDoc** on every function and exported component.
3. **Document all props** with inline comments on the interface.
4. Use **CSS variables** — no magic colours or sizes.
5. **Named exports** for all components (except default `App`).
6. **No external state libraries** — React hooks only for now.

## Next: AI Integration

See [AGENTS.md § 8](./AGENTS.md#8-ai-integration) for the step-by-step plan.
Short version: `npm install openai`, create `src/services/aiService.ts`,
wire up `handleSend()` in `App.tsx`.
