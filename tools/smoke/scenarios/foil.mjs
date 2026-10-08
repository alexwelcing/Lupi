/**
 * foil.mjs - the three Foil finishes in the real viewer (LOCAL smoke plugin,
 * not CI).
 *
 *   node tools/verify-viewer-smoke.mjs --scenarios=foil --backend=both \
 *     --profile=desktop --strict-backend --out=.verify-artifacts/viewer-smoke/foil
 *
 * One r1 code per finish (Holo, Gold leaf, Pearl) is found the way
 * ui/src/remix/code.ts finds a finish: `fmix32(fnv1a(text)) mod 24 == 0`, the
 * finish from the next digits, over codes with both flags off (CPK colours,
 * a plain gradient backdrop, so the look stays exportable). On C60 and on
 * caffeine:
 * 1. Each code applied with __lupiPlay.remix(code) carries its finish; past
 *    the 900 ms sweep and the 600 ms look morph the view is saved, then again
 *    after a small lupi.set_camera turn (the sheen and glitter follow the view).
 * 2. Quiet Idle with a finish on: __lupiPlay.state().frames does not move on
 *    a still view, and two screenshots a second apart are identical.
 * 3. The capture guard: lupi.export_asset PNG (bonds hidden) has the same
 *    artifactDigest with the Foil code's finish on and with it turned Off in
 *    the Remix sheet, over the same look.
 */

const MOLECULES = ['c60_buckyball', 'caffeine'];

// The finder mirrors ui/src/remix/code.ts (the frozen r1 codec and foil rule).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const FOIL_KINDS = ['holo', 'gold', 'pearl'];

function codeText(payload) {
  let out = '';
  for (let i = 4; i >= 0; i -= 1) out += ALPHABET[(payload >>> (i * 5)) & 31];
  return `r1-${out}`;
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function fmix32(value) {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** The finish a code text carries, or null (code.ts `remixFoil`). */
export function foilOf(text) {
  const h = fmix32(fnv1a(text));
  if (h % 24 !== 0) return null;
  return FOIL_KINDS[Math.floor(h / 24) % FOIL_KINDS.length];
}

/** The first code (both flags off, seed from 1) for each finish. */
export function foilCodes() {
  const codes = {};
  for (let seed = 1; seed < 1 << 23 && Object.keys(codes).length < FOIL_KINDS.length; seed += 1) {
    const text = codeText(seed);
    const kind = foilOf(text);
    if (kind && !codes[kind]) codes[kind] = text;
  }
  return codes;
}

const LOOK_SETTLE_MS = 600 + 900 + 400;

async function remix(page, command) {
  return page.evaluate((value) => window.__lupiPlay?.remix?.(value) ?? null, command);
}

async function waitRemixed(page, h, maxMs = 8_000) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < maxMs) {
    state = await remix(page);
    if (state && !state.morphing) break;
    await h.sleep(100);
  }
  await h.sleep(LOOK_SETTLE_MS);
  return state;
}

async function execute(page, h, tool, args, label) {
  return h.withTimeout(page.evaluate(({ tool: name, args: values, id }) => window.__lupiViewerMcp.execute({ id, tool: name, arguments: values }), { tool, args, id: `foil-${label}` }), 120_000, label);
}

/** Turn the camera about the world vertical through its target (instant, like every MCP camera tool). */
async function turnCamera(page, h, degrees) {
  const rig = (await h.readPlay(page))?.rig;
  if (!rig?.position || !rig?.target) return null;
  const a = (degrees * Math.PI) / 180;
  const [px, py, pz] = rig.position;
  const [tx, ty, tz] = rig.target;
  const dx = px - tx;
  const dz = pz - tz;
  const position = [tx + dx * Math.cos(a) + dz * Math.sin(a), py, tz - dx * Math.sin(a) + dz * Math.cos(a)];
  const out = await execute(page, h, 'lupi.set_camera', { position, target: [tx, ty, tz] }, `turn-${degrees}`);
  return out.ok ? position : null;
}

async function exportDigest(page, h, label) {
  const out = await execute(page, h, 'lupi.export_asset', {
    format: 'png', width: 256, height: 256, transparent: false, fitCamera: false, timeoutMs: 45_000,
  }, `export-${label}`);
  return { ok: out.ok, error: out.error ?? null, digest: out.result?.asset?.artifactDigest ?? null };
}

/** Finish → Off in the Remix sheet, opened from the pill's Foil chip, then closed. */
async function finishOff(page, h) {
  // A DOM click: the chip's foil border animates, so it is never "stable" for a pointer click.
  const opened = await page.evaluate(() => {
    const chip = document.querySelector('[data-remix="foil"]');
    chip?.click();
    return Boolean(chip);
  });
  if (!opened) return false;
  const sheet = page.locator('[data-lupi-remix-sheet]').first();
  await sheet.waitFor({ state: 'visible', timeout: 10_000 });
  await sheet.getByRole('radio', { name: 'Off', exact: true }).evaluate((el) => el.click());
  await sheet.getByRole('button', { name: 'Close', exact: true }).evaluate((el) => el.click());
  await h.sleep(600);
  return true;
}

export default {
  name: 'foil',
  profiles: ['desktop', 'phone390'],
  description: 'Holo, Gold leaf and Pearl on C60 and caffeine: the finish shows, follows a camera turn, a still view draws no frames, exports never carry it.',

  async run(ctx, h) {
    const { page, check, save, outcome } = ctx;
    const codes = foilCodes();
    outcome.data.codes = codes;
    if (!check('one r1 code per finish', FOIL_KINDS.every((kind) => codes[kind]), JSON.stringify(codes))) return;

    for (const id of MOLECULES) {
      const canvas = await h.openStructure(ctx, h.galleryEntry(id));
      if (!canvas) return;
      await h.waitSettled(page, canvas, 0.01);
      const short = id.split('_')[0];

      for (const kind of FOIL_KINDS) {
        const applied = await remix(page, codes[kind]);
        check(`${short}: ${codes[kind]} carries ${kind}`, applied?.foil === kind && applied?.finish === kind, JSON.stringify(applied));
        await waitRemixed(page, h);
        const shown = await h.waitSettled(page, canvas, 0.01, 12_000);
        await save(`${short}-${kind}`, shown.png);
        const turned = await turnCamera(page, h, 10);
        const after = await h.waitSettled(page, canvas, 0.01, 12_000);
        await save(`${short}-${kind}-turned`, after.png);
        const changed = h.diffImages(shown.image, after.image).changed / (after.image.width * after.image.height);
        check(`${short} ${kind}: a 10° turn changes the view`, Boolean(turned) && changed > 0.002, `changed=${h.pct(changed)}`);
      }

      // Quiet Idle with Pearl (the last finish) on screen.
      const quiet = await h.waitSettled(page, canvas, 0.01, 12_000);
      const before = (await h.readPlay(page))?.frames ?? null;
      await h.sleep(1_500);
      const again = await h.captureCanvas(page, canvas);
      await h.sleep(1_000);
      const later = (await h.readPlay(page))?.frames ?? null;
      const still = await h.captureCanvas(page, canvas);
      const awakeBy = (await h.readPlay(page))?.frameDemand?.awakeBy ?? null;
      const same = h.diffImages(again.image, still.image).changed;
      outcome.data[`${short}-quiet`] = { before, later, awakeBy, settled: quiet.meta };
      check(`${short}: a still view with a finish draws no frames`, before !== null && before === later, `frames ${before} → ${later}; awakeBy ${JSON.stringify(awakeBy)}`);
      check(`${short}: two screenshots of the still view are identical`, same === 0, `${same} pixels differ`);
    }

    // The capture guard, on caffeine with Gold leaf, bonds hidden.
    await remix(page, codes.gold);
    await waitRemixed(page, h);
    const hidden = await execute(page, h, 'lupi.set_viewer', { showBonds: false }, 'hide-bonds');
    check('bonds hide for the raster export', hidden.ok, JSON.stringify(hidden.error ?? null));
    await h.sleep(500);
    const withFoil = await exportDigest(page, h, 'gold');
    const off = await finishOff(page, h);
    const state = await remix(page);
    check('Finish → Off hides the finish and keeps the code', off && state?.finish === null && state?.code === codes.gold, JSON.stringify(state));
    const withoutFoil = await exportDigest(page, h, 'off');
    outcome.data.exports = { withFoil, withoutFoil };
    check('export with a finish on succeeds', withFoil.ok && Boolean(withFoil.digest), JSON.stringify(withFoil.error));
    check('export with the finish off succeeds', withoutFoil.ok && Boolean(withoutFoil.digest), JSON.stringify(withoutFoil.error));
    check('the export never carries the finish (same artifactDigest)', withFoil.digest === withoutFoil.digest, `${withFoil.digest} vs ${withoutFoil.digest}`);
  },
};
