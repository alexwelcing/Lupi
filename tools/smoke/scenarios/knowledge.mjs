/**
 * knowledge.mjs - the sphere-grid's knowledge labels, the atom card's node
 * path, the Save button and the /#/mcp harness (LOCAL smoke plugin, not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=knowledge --backend=webgl \
 *     --profile=desktop --out=.verify-artifacts/viewer-smoke/knowledge
 *
 * On /?sim=lupine_sphere_grid (1,513 atoms, 1,513 labels whose node ids are
 * mostly local paths):
 * 1. Knowledge labels render, and a camera move recomputes them.
 * 2. Clicking an atom opens its card with the node's path, and no visible
 *    text, tooltip or accessible name on the page shows a home directory
 *    (/home/<user>/, /Users/<user>/, C:\Users\): the display is scrubbed.
 * 3. lupi.knowledge_graph still returns the label's node id as the labels
 *    file has it (MCP output is unchanged; the report records it).
 * 4. The Save panel names the open molecule, and the next one after a switch.
 * 5. /#/mcp: the harness's idle raw response reads the loaded file, and
 *    re-reads it when the atom scale changes.
 */

const ID = 'lupine_sphere_grid';
const HOME = '/home/[^/\\s]+/|/Users/[^/\\s]+/|[A-Za-z]:\\\\Users\\\\';

/** Page-side: every visible text, tooltip and accessible name that shows a home directory. */
const homePathsShown = (page) => page.evaluate((pattern) => {
  const home = new RegExp(pattern);
  const found = [];
  if (home.test(document.body.innerText)) {
    found.push(...document.body.innerText.split('\n').filter((line) => home.test(line)).slice(0, 3).map((line) => `text: ${line.trim().slice(0, 90)}`));
  }
  for (const node of document.querySelectorAll('[title], [aria-label]')) {
    for (const attr of ['title', 'aria-label']) {
      const value = node.getAttribute(attr);
      if (value && home.test(value)) found.push(`${attr}: ${value.slice(0, 90)}`);
    }
  }
  return found;
}, HOME);

const mcp = (page, tool, args) => page.evaluate(({ name, input }) => window.__lupiViewerMcp.execute({ id: `knowledge-${name}`, tool: name, arguments: input }), { name: tool, input: args });

export default {
  name: 'knowledge',
  profiles: ['desktop'],
  description: 'Sphere-grid knowledge labels render; the atom card never shows a home path; MCP ids unchanged; Save panel and /#/mcp follow the file.',

  async run(ctx, h) {
    const { page, check, save, outcome } = ctx;
    const canvas = await h.openStructure(ctx, h.galleryEntry(ID));
    if (!canvas) return;

    // 1. Labels render, and follow the camera.
    const perf = await page.waitForFunction(() => (window.__atlas?.labelPerf?.renderedLabels ?? 0) > 0 && window.__atlas.labelPerf, null, { timeout: 60_000, polling: 250 })
      .then((handle) => handle.jsonValue(), () => null);
    const cards = await page.locator('div[title*="connection"]').count();
    check('knowledge labels render', Boolean(perf) && perf.renderedLabels > 0, `${perf?.renderedLabels ?? 0} labels (max ${perf?.maxCount ?? '?'}), ${cards} card(s) with a connection count`);
    const before = perf?.timestamp ?? 0;
    await mcp(page, 'lupi.set_camera_preset', { preset: 'top' });
    const moved = await page.waitForFunction((t) => (window.__atlas?.labelPerf?.timestamp ?? 0) > t, before, { timeout: 30_000, polling: 250 }).then(() => true, () => false);
    const after = await page.evaluate(() => window.__atlas?.labelPerf ?? null);
    check('a camera move recomputes the labels', moved && after?.renderedLabels > 0, `${after?.renderedLabels ?? 0} labels after the top preset`);
    await mcp(page, 'lupi.fit_camera', {});

    // 2. The atom card: a node's path, never a home directory. Click atoms
    // until a card opens (a software renderer can take seconds to pick).
    const settled = await h.waitSettled(page, canvas, 0.01);
    const card = page.locator('[data-testid="atom-info-card"]').first();
    const box = await canvas.boundingBox();
    let shown = false;
    for (const candidate of h.atomCandidates(settled.image, 4)) {
      await page.mouse.click(Math.round(box.x + candidate.x), Math.round(box.y + candidate.y));
      shown = await card.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
      if (shown) break;
    }
    const nodeLine = shown
      ? await card.evaluate((node) => {
        const line = [...node.querySelectorAll('div[title]')].find((el) => el.getAttribute('title')?.includes('://'));
        return line ? { text: line.textContent, title: line.getAttribute('title') } : null;
      }, null, { timeout: 90_000 })
      : null;
    outcome.data.card = nodeLine;
    const leaks = await homePathsShown(page);
    outcome.data.homePathsShown = leaks;
    if (shown) await save('card', await page.screenshot({ scale: 'css' }));
    check('clicking an atom opens its card with the node path', shown && Boolean(nodeLine?.text), JSON.stringify(nodeLine));
    check('no visible text, tooltip or accessible name shows a home directory', shown && leaks.length === 0, leaks.join(' | ') || 'none');

    // 3. MCP output is unchanged: the id as the labels file has it.
    const graph = await mcp(page, 'lupi.knowledge_graph', { query: 'SOUL.md', limit: 3 });
    const file = await page.evaluate(() => fetch('/generated/lupine-wiki/sphere-grid.labels.json').then((r) => r.json()).catch(() => null));
    const expected = file?.labels?.find((l) => l.text === 'SOUL.md')?.node_id ?? null;
    const returned = graph?.result?.knowledgeGraph?.nodes?.find((n) => n.text === 'SOUL.md')?.nodeId ?? null;
    outcome.data.mcpNodeId = returned;
    check('lupi.knowledge_graph returns the node id unchanged', Boolean(expected) && returned === expected, `returned ${returned}`);

    // 4. The Save panel names the open molecule, then the next one.
    const savePanel = async () => {
      // A DOM click: the viewer rewrites its address as it settles, which a
      // Playwright click would wait on as a navigation.
      await page.waitForFunction(() => document.querySelector('[data-testid="lupi-save-view-button"]') !== null, null, { timeout: 90_000, polling: 250 });
      await page.evaluate(() => document.querySelector('[data-testid="lupi-save-view-button"]').click());
      const panel = page.getByTestId('lupi-save-view-panel').first();
      const open = await panel.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
      const text = open ? (await panel.textContent()).replace(/\s+/g, ' ') : '';
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
      return text;
    };
    const first = await savePanel();
    check('the Save panel names the open molecule', /Sphere Grid/i.test(first), first.slice(0, 120));
    const switched = await mcp(page, 'lupi.open_gallery_example', { id: 'caffeine', expectedAtomCount: 24, maxAtomCount: 50_000 });
    // The switch's first frame can hold a software renderer's main thread for seconds.
    await page.waitForFunction(() => window.__lupiViewerMcp?.status?.().atomCount === 24 && window.__lupiPlay?.state?.().firstFrame === true, null, { timeout: 90_000, polling: 250 }).catch(() => {});
    const second = switched?.ok ? await savePanel() : '';
    check('after a switch it names the new molecule', /Caffeine/i.test(second) && !/Sphere Grid/i.test(second), second.slice(0, 120));

    // 5. /#/mcp in the same document (the route reopens ?sim=, the sphere
    // grid, without the harness's own loader): with no harness response yet,
    // the raw panel reads the viewer state, and re-reads it when the atom
    // scale changes (a bridge call emits no harness response).
    await page.evaluate(() => {
      window.location.hash = '#/mcp';
    });
    const harness = await page.getByTestId('lupine-mcp-harness').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
    await page.waitForFunction(() => window.__lupiViewerMcp?.status?.().atomCount === 1513 && window.__lupiPlay?.state?.().firstFrame === true, null, { timeout: 90_000, polling: 250 }).catch(() => {});
    await page.evaluate(() => document.querySelector('[data-testid="lupine-mcp-panel-response"]')?.click());
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Show raw response'), null, { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Show raw response')?.click());
    await page.waitForFunction(() => document.querySelector('pre[data-testid="lupine-mcp-response"]') !== null, null, { timeout: 10_000 }).catch(() => {});
    const raw = page.getByTestId('lupine-mcp-response');
    const name = await page.evaluate(() => window.__lupiViewerMcp?.state?.().fileName ?? null);
    const scale = await page.evaluate(() => window.__lupiViewerMcp?.state?.().atomScale ?? null);
    const idle = (await raw.textContent().catch(() => '')) ?? '';
    const want = scale === 1.37 ? 1.21 : 1.37;
    const set = await mcp(page, 'lupi.set_viewer', { atomScale: want });
    const followed = await page.waitForFunction((value) => (document.querySelector('[data-testid="lupine-mcp-response"]')?.textContent ?? '').includes(`"atomScale": ${value}`), want, { timeout: 60_000, polling: 250 })
      .then(() => true, () => false);
    const stored = await page.evaluate(() => window.__lupiViewerMcp?.state?.().atomScale ?? null);
    outcome.data.harness = { name, scale, want, set: set?.ok ?? null, stored, idle: idle.slice(0, 160) };
    await save('harness', await page.screenshot({ scale: 'css' }));
    check('/#/mcp: the idle raw response reads the loaded file', harness && Boolean(name) && idle.includes(`"fileName": ${JSON.stringify(name)}`), `file ${JSON.stringify(name)}, raw ${idle.length} chars`);
    check('/#/mcp: it re-reads the state when the atom scale changes', Boolean(set?.ok) && followed, `atomScale ${scale} -> ${want} (store ${stored})`);
  },
};
