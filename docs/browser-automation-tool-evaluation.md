# Browser-Automation Tool Evaluation for Lupi MCP Bridge Verification

**Context:** The Lupi `verify-mcp-bridge` script currently opens a local Vite-served React/Vite app in a headless Chromium tab via Playwright, drives the in-page `window.__lupiViewerMcp` API, and asserts state. We want to know whether an alternative would be better for this specific in-browser MCP bridge verification use case.

**Evaluation axes:**
1. Headless / remote browser control
2. API surface (how easy for an agent to use)
3. TypeScript/Node support
4. Observability / debuggability
5. Maturity / ecosystem
6. MCP-specific features

---

## 1. Playwright

**Type:** Open-source browser automation library (Node.js, Python, .NET, Java).
**Headless/remote:** First-class headless Chromium/WebKit/Firefox; connect-over-CDP to remote Chrome; Playwright Test runner; supports browser contexts and traces.
**API surface:** Modern, async/await TypeScript-first API; `page.evaluate`, `page.waitForFunction`, `locator`, built-in auto-waiting, screenshots, network interception.
**TypeScript/Node:** Excellent; the project already uses `playwright@^1.59.1` and the verify script is TypeScript-ESM.
**Observability/debuggability:** Best-in-class: built-in trace viewer (`npx playwright show-trace`), UI mode, screenshots, video, network HAR, console/page-error listeners, retries.
**Maturity:** Very high; Microsoft-backed, industry standard for E2E testing.
**MCP-specific features:** None directly; it is a general-purpose browser driver. For Lupi it is used to evaluate JS that calls the page-native `window.__lupiViewerMcp` driver.
**Verdict for Lupi:** Already the incumbent; excellent fit for deterministic bridge verification.

---

## 2. Puppeteer

**Type:** Open-source library (Google Chrome DevTools Protocol wrapper).
**Headless/remote:** Supports headless Chromium/Chrome and CDP connection to remote browsers; also supports Firefox experimentally.
**API surface:** Lower-level than Playwright; `page.evaluate` works similarly, but selectors, auto-waiting, and multi-browser support are less polished.
**TypeScript/Node:** Good first-class Node/TS support.
**Observability/debuggability:** Strong if you use DevTools or Chrome logs, but no built-in trace viewer/UI mode like Playwright; screenshots and console capture available.
**Maturity:** High, but Playwright has overtaken it for new test projects.
**MCP-specific features:** None.
**Verdict for Lupi:** A possible replacement, but it would be a downgrade in ergonomics and observability with no benefit for the current script.

---

## 3. Selenium

**Type:** Open-source framework and W3C WebDriver ecosystem.
**Headless/remote:** Supports local/remote WebDriver, Selenium Grid, headless Chrome/Firefox/Edge/Safari.
**API surface:** WebDriver standard; more verbose, less ergonomic than Playwright; browser-native JS execution is possible via `execute_script`.
**TypeScript/Node:** Supported via `selenium-webdriver`, but it is a much thinner community in modern TS compared with Playwright.
**Observability/debuggability:** Grid logs, screenshots, but the ecosystem feels dated compared to Playwright traces.
**Maturity:** Extremely mature, but legacy for greenfield web testing.
**MCP-specific features:** None.
**Verdict for Lupi:** Overkill and less ergonomic; no advantage for an in-page JS bridge test.

---

## 4. Browserbase + Stagehand

**Type:** Browserbase is a **cloud browser service** (SaaS); Stagehand is an **open-source TypeScript SDK** that wraps Playwright/Puppeteer with LLM-native primitives (`act`, `extract`, `observe`, `agent`).
**Headless/remote:** Browserbase hosts headless browsers remotely; Stagehand can run locally with local Chrome or connect to Browserbase.
**API surface:** Natural-language/agentic API (`page.act("click the submit button")`, `page.extract(schema)`). It is higher-level and targeted at AI agents rather than deterministic scripts.
**TypeScript/Node:** Excellent; TypeScript-first.
**Observability/debuggability:** Browserbase provides session replay, action caching, prompt observability; Stagehand logs LLM reasoning.
**Maturity:** Stagehand is popular but newer; Browserbase is a commercial platform.
**MCP-specific features:** Not an MCP server, but there are community experiments with Browserbase/Stagehand MCP servers.
**Verdict for Lupi:** Not a good fit for `verify-mcp-bridge`. The current test is deterministic and does not need natural-language DOM reasoning; adding a remote cloud dependency and LLM cost would slow CI and make it flaky. Useful later for live public-URL agentic testing, but not for the bridge verification script.

---

## 5. Browser-use

**Type:** Open-source Python agentic browser-automation library with a managed cloud offering (Browser Use Cloud).
**Headless/remote:** Local Chrome via Playwright under the hood; cloud option available for remote browsers.
**API surface:** Python-first; agent runs on a natural-language task, returns results, uses LLM planning.
**TypeScript/Node:** Poor for this repo; Python-based, so it would add a second language/toolchain to the Node/TS workspace.
**Observability/debuggability:** Uses Playwright traces; cloud dashboard has replays.
**Maturity:** Trending but young; rapid breaking changes.
**MCP-specific features:** There are community/browser-use MCP server integrations, but it is not natively an MCP server.
**Verdict for Lupi:** Bad fit. The verify script is Node/TS, deterministic, and in-page API driven; a Python agent framework would add friction and LLM non-determinism.

---

## 6. Anthropic Browser-Computer-Use (Claude Computer Use)

**Type:** Anthropic **platform tool/API feature** for computer control, not a standalone library. There is an open-source reference/demo (`anthropic-cookbook` patterns) and a Claude Code integration.
**Headless/remote:** Requires a desktop/container with a browser or VNC; the model receives screenshots and emits mouse/keyboard actions.
**API surface:** LLM-driven; the caller sends screenshots and tool-use actions. Deterministic API calls are not the primary model.
**TypeScript/Node:** SDK exists, but computer use is API/model-oriented, not a Node browser driver.
**Observability/debuggability:** Full screenshot/action stream via Anthropic API logs; expensive and slow for deterministic checks.
**Maturity:** Anthropic-supported, production-grade for agent use, but not a test framework.  **MCP-specific features:** Not an MCP server by itself, though Claude Code can use MCP tools and also has computer use. There is no standard Anthropic MCP server for this.
**Verdict for Lupi:** Massive overkill for a verification script. It would replace a few `page.evaluate` calls with screenshot→LLM→mouse actions, which is slower, costlier, and less reliable.

---

## 7. Skyvern

**Type:** Open-source AI browser-workflow automation framework (Python backend + TypeScript frontend).
**Headless/remote:** Self-hosted with Docker or cloud version; runs headless Playwright browsers under the hood.
**API surface:** Goal-driven workflows (natural language goals + selectors); REST API; not a direct in-page JS driver.  **TypeScript/Node:** Not a Node library; requires Python/PostgreSQL/Redis backend.  **Observability/debuggability:** Web UI, action logs, screenshots.  **Maturity:** Active, but designed for long-form web workflows, not fast deterministic unit-like checks.  **MCP-specific features:** Not an MCP server natively; there are experimental integrations.  **Verdict for Lupi:** Poor fit for the same reasons as Browser-use: wrong language, wrong abstraction level, adds infrastructure.

---

## 8. Other Notable Tools

- **Cypress:** Component/E2E test runner, excellent for web apps but no native in-page JS evaluation at the level Playwright offers and no multi-browser support; not a replacement here.
- **WebdriverIO:** WebDriver wrapper; more mature than Selenium-JS but still less ergonomic than Playwright.
- **Chrome DevTools Protocol (CDP) raw:** Possible, but would require writing a driver layer; Playwright already abstracts this well.
- **MCP Servers for browsers:** There are emerging community MCP servers that expose browser tools via the Model Context Protocol (e.g., browser-use MCP, Playwright MCP, Browserbase MCP experiments). These are useful for an LLM agent to *ask* a browser to do things, but they are not a replacement for a deterministic verification script that runs in CI and asserts state.

---

## Recommendation

**Keep Playwright for `verify-mcp-bridge.mjs`.** It is the best fit because:

- The workspace already uses Playwright (`playwright@^1.59.1`).
- The test is deterministic, in-page JS execution (`page.evaluate` against `window.__lupiViewerMcp`), with no need for natural-language DOM reasoning.
- Playwright has best-in-class TypeScript/Node support, headless Chromium, traces, screenshots, and console/page-error capture.
- There is no MCP-specific feature required that another tool provides; the Lupi MCP bridge is exposed as a page-global JS object, so any browser driver can reach it, and Playwright is the fastest and most reliable way.

**When to consider a supplement (not replacement):**

- **Browserbase/Stagehand** could be useful later for a separate, optional smoke test against a deployed public URL where DOM structure and network conditions vary and agentic resilience is valuable.
- **Browser-use** or **Anthropic Computer Use** could be explored for a higher-level "agent demo" harness, but not for the deterministic CI verification script.
- **A community Playwright MCP server** could be useful if the goal is to let an external LLM agent drive the browser via MCP tools; however, the Lupi bridge itself is already a page-native MCP-like API, so that would be an extra layer, not a replacement.

**Conclusion:** No compelling reason to switch from Playwright for this use case. If the project later wants both deterministic and agentic browser tests, the right architecture is **Playwright for the MCP bridge verification** plus a separate, optional agentic tool for exploratory/public-URL testing.
