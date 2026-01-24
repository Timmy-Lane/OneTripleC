---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: '*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json'
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Intent Lifecycle

The system processes user intents through a state machine:

### State Transitions

```
CREATED → PARSING → PARSED → QUOTE_REQUESTED → QUOTED → ACCEPTED → EXECUTING → COMPLETED
    ↓         ↓        ↓           ↓              ↓          ↓           ↓
  FAILED   FAILED   FAILED      FAILED         FAILED     FAILED      FAILED
    ↓         ↓        ↓           ↓              ↓          ↓
CANCELLED CANCELLED CANCELLED   EXPIRED       EXPIRED   CANCELLED
```

### Intent States

| State | Description |
|-------|-------------|
| CREATED | Intent received from user, awaiting parsing |
| PARSING | Worker is parsing the raw message |
| PARSED | Intent successfully parsed, ready for quote |
| QUOTE_REQUESTED | Quotes being fetched (future) |
| QUOTED | Quotes available for user review (future) |
| ACCEPTED | User accepted a quote (future) |
| EXECUTING | Transaction being executed (future) |
| COMPLETED | Intent fully executed |
| FAILED | Error occurred at any stage |
| CANCELLED | User cancelled the intent |
| EXPIRED | Quote or intent expired |

### Flow

1. **API** (`POST /intents`): Creates intent in `CREATED` state, enqueues `parse-intent` job
2. **Worker**: Picks up job, transitions `CREATED → PARSING → PARSED` (or `FAILED`)
3. **Worker**: On success, enqueues `fetch-quotes` job (stub)
4. **API** (`GET /intents/:id`): Returns current intent state

### Queue Architecture

- **Queue Name**: `intent-queue`
- **Job Types**:
  - `parse-intent`: Parse raw message to extract intent fields
  - `fetch-quotes`: Fetch quotes from DEXs/bridges (stub)

### Files

| Component | Path |
|-----------|------|
| API Routes | `src/api/routes/intents.ts` |
| Domain Service | `src/domain/intents/intent-service.ts` |
| Repository | `src/persistence/repositories/intent-repository.ts` |
| Queue Service | `src/services/queue.ts` |
| Worker | `src/workers/index.ts` |

### Running Locally

```sh
# Start dependencies
docker compose up -d

# Run API server
bun run src/api/server.ts

# Run workers (in separate terminal)
bun run src/workers/index.ts
```

### Testing the Flow

```sh
# Create an intent (replace USER_ID with a valid user UUID)
curl -X POST http://localhost:3000/intents \
  -H "Content-Type: application/json" \
  -d '{"userId": "USER_ID", "rawMessage": "swap 100 USDC to ETH"}'

# Check intent status
curl http://localhost:3000/intents/INTENT_ID
```
