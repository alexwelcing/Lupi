/**
 * Pure-logic tests for the Gooten client. No network, no secrets.
 * The template fixture is the exact response shape from Gooten's public docs
 * (Products – List of Product Templates), including the archived-option and
 * multi-layer cases that caused the real bugs.
 *
 *   node --test scripts/gooten.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { printSpecFromTemplate, resolveVariant, buildPrpPayload } from '../src/gooten.mjs';

const TEMPLATE = {
  Options: [
    {
      DPI: 300, Format: 'png', Name: 'Single', IsDefault: true, IsArchived: false,
      Spaces: [{
        Id: '63AD0', Index: 1, Description: 'Default',
        Layers: [
          { Id: '57EA9', Type: 'Design', ZIndex: 0, X1: 0, X2: 1205, Y1: 0, Y2: 2020, IncludeInPrint: false },
          { Id: 'EAA4C', Type: 'Image', Description: 'image_specs', ZIndex: 1, X1: 0, X2: 1205, Y1: 0, Y2: 2020, IncludeInPrint: true },
          { Id: '242F4', Type: 'Design', Description: 'mask', ZIndex: 2, X1: 0, X2: 1205, Y1: 0, Y2: 2020, IncludeInPrint: false },
          { Id: 'FC06D', Type: 'Bleed', ZIndex: 4, X1: 0, X2: 1205, Y1: 0, Y2: 2020, IncludeInPrint: false },
        ],
      }],
    },
    { DPI: 300, Format: 'png', Name: 'Legacy', IsDefault: false, IsArchived: true, ArchivedReason: 2, Spaces: [] },
  ],
};

test('printSpecFromTemplate reads the Image layer as the print box, ignores design/mask/bleed', () => {
  const spec = printSpecFromTemplate(TEMPLATE);
  assert.equal(spec.templateName, 'Single');
  assert.equal(spec.dpi, 300);
  assert.equal(spec.format, 'png');
  assert.deepEqual(spec.spaces, [{ spaceId: '63AD0', description: 'Default', width: 1205, height: 2020 }]);
});

test('printSpecFromTemplate skips archived templates', () => {
  assert.throws(() => printSpecFromTemplate(TEMPLATE, { templateName: 'Legacy' }), /no usable/);
});

test('printSpecFromTemplate throws when no printable layer exists', () => {
  const t = { Options: [{ Name: 'X', DPI: 300, IsDefault: true, Spaces: [{ Id: 'A', Layers: [{ Type: 'Design', IncludeInPrint: false }] }] }] };
  assert.throws(() => printSpecFromTemplate(t), /no printable Image layer/);
});

test('printSpecFromTemplate handles multi-space (front/back) products', () => {
  const t = {
    Options: [{
      Name: 'FrontBack', DPI: 150, Format: 'PNG', IsDefault: true,
      Spaces: [
        { Id: 'F1', Description: 'Front', Layers: [{ Type: 'Image', IncludeInPrint: true, X1: 0, X2: 1800, Y1: 0, Y2: 2400 }] },
        { Id: 'B1', Description: 'Back', Layers: [{ Type: 'Image', IncludeInPrint: true, X1: 0, X2: 1800, Y1: 0, Y2: 2400 }] },
      ],
    }],
  };
  const spec = printSpecFromTemplate(t);
  assert.equal(spec.spaces.length, 2);
  assert.deepEqual(spec.spaces.map((s) => s.spaceId), ['F1', 'B1']);
  assert.equal(spec.format, 'png');
});

const VARIANTS = [
  { Sku: 'Apparel-DTG-Tshirt-Bella-3200-S-Black-Unisex-CFCB', productId: 1196 },
  { Sku: 'Apparel-DTG-Tshirt-Bella-3200-M-Black-Unisex-CFCB', productId: 1196 },
  { Sku: 'Apparel-DTG-Tshirt-Bella-3200-M-White-Unisex-CFCB', productId: 1196 },
  { Sku: 'WallArt-Poster-11x14-Matte', productId: 700 },
  { Sku: 'WallArt-Poster-16x20-Matte', productId: 700 },
];

test('resolveVariant returns the single match', () => {
  assert.equal(resolveVariant(VARIANTS, ['poster', '11x14']).Sku, 'WallArt-Poster-11x14-Matte');
  assert.equal(resolveVariant(VARIANTS, ['tshirt', '-m-', 'white']).productId, 1196);
});

test('resolveVariant refuses to guess when ambiguous, and names the candidates', () => {
  assert.throws(() => resolveVariant(VARIANTS, ['tshirt', 'black']), /ambiguous: 2 .*Bella-3200-S-Black.*Bella-3200-M-Black/s);
});

test('resolveVariant fails when nothing matches', () => {
  assert.throws(() => resolveVariant(VARIANTS, ['hoodie']), /no Gooten variant matches/);
});

test('buildPrpPayload produces the documented wire shape', () => {
  const payload = buildPrpPayload({
    sku: 'LUPI-CAF-POST',
    name: 'Caffeine Molecule Poster',
    items: [{
      productId: 700,
      productVariantSku: 'WallArt-Poster-11x14-Matte',
      templateName: 'Single',
      preconfigurations: [{ spaceId: '63AD0', url: 'https://lupi.live/assets/sha256-abc.png' }],
    }],
    images: ['https://lupi.live/assets/sha256-abc.png'],
  });
  assert.equal(payload.Sku, 'LUPI-CAF-POST');
  assert.equal(payload.Description, 'Caffeine Molecule Poster');
  assert.deepEqual(payload.Items[0].Preconfigurations, [{ SpaceId: '63AD0', Url: 'https://lupi.live/assets/sha256-abc.png' }]);
  assert.deepEqual(payload.Images, [{ Url: 'https://lupi.live/assets/sha256-abc.png', Index: 0 }]);
});

test('buildPrpPayload rejects incomplete input', () => {
  assert.throws(() => buildPrpPayload({ name: 'x', items: [{}] }), /requires a Sku/);
  assert.throws(() => buildPrpPayload({ sku: 'x', name: 'x', items: [] }), /at least one item/);
});

test('redact strips the secret, and is a no-op (not a space-eater) when unset', async () => {
  const { redact } = await import('../src/gooten.mjs');
  const prev = process.env.GOOTEN_RECIPE_ID;
  delete process.env.GOOTEN_RECIPE_ID;
  assert.equal(redact('a b c'), 'a b c');
  process.env.GOOTEN_RECIPE_ID = 'super-secret-id';
  assert.equal(redact('call with super-secret-id failed'), 'call with <recipeid> failed');
  if (prev === undefined) delete process.env.GOOTEN_RECIPE_ID; else process.env.GOOTEN_RECIPE_ID = prev;
});
