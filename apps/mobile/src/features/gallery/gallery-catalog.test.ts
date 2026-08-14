import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MOBILE_GALLERY_IDS,
  mobileGalleryAtomCount,
} from "@/src/domain/mobile-gallery";

import {
  CURATED_GALLERY,
  CURATED_GALLERY_IDS,
  GALLERY_FILTERS,
  MOBILE_GALLERY_MAX_ATOMS,
  filterGalleryItems,
  galleryFilterCount,
  galleryThumbnailUrl,
  selectGalleryPresentation,
} from "./gallery-catalog";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
const WEB_PUBLIC_ROOT = join(REPO_ROOT, "apps", "web", "public");
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

test("curated gallery is an exact fail-closed canonical allowlist", () => {
  assert.deepEqual(
    [...CURATED_GALLERY_IDS].sort(),
    [...MOBILE_GALLERY_IDS].sort(),
  );
  assert.equal(new Set(CURATED_GALLERY_IDS).size, CURATED_GALLERY.length);

  for (const item of CURATED_GALLERY) {
    assert.match(item.id, /^[a-z0-9]+(?:_[a-z0-9]+)*$/);
    assert.equal(item.load.inputType, "gallery");
    assert.equal(item.load.input, item.id);
    assert.equal(item.load.atomCount, item.atomCount);
    assert.equal(item.atomCount, mobileGalleryAtomCount(item.id));
    assert.ok(Number.isSafeInteger(item.atomCount));
    assert.ok(item.atomCount > 0 && item.atomCount <= MOBILE_GALLERY_MAX_ATOMS);
    assert.ok(Number.isSafeInteger(item.frameCount) && item.frameCount > 0);
    assert.ok(item.tags.length > 0);
    assert.equal(item.palette.length, 3);
    if (item.thumbnailPath) {
      assert.equal(item.thumbnailPath, `gallery/snapshots/${item.id}.jpg`);
      assert.doesNotMatch(item.thumbnailPath, /^https?:/i);
    }
  }
});

test("curated records match canonical gallery data and materialized mobile assets", () => {
  const canonical = JSON.parse(
    readFileSync(
      join(REPO_ROOT, "packages", "ui", "src", "gallery-data.json"),
      "utf8",
    ),
  ) as {
    atoms?: string;
    available?: boolean;
    file?: string;
    id?: string;
  }[];
  const byId = new Map(canonical.map((item) => [item.id, item]));

  for (const item of CURATED_GALLERY) {
    const source = byId.get(item.id);
    assert.ok(source, `canonical gallery record missing for ${item.id}`);
    assert.equal(source.available, true, `${item.id} must remain available`);
    assert.equal(
      parseCanonicalCount(source.atoms),
      item.atomCount,
      `${item.id} atom count drifted`,
    );
    assert.ok(source.file, `${item.id} must declare a source file`);

    const sourcePath = resolve(WEB_PUBLIC_ROOT, source.file);
    assert.ok(
      sourcePath.startsWith(`${WEB_PUBLIC_ROOT}${sep}`),
      `${item.id} source escaped web public root`,
    );
    assert.equal(
      existsSync(sourcePath),
      true,
      `${item.id} source is not materialized`,
    );
    assert.ok(
      statSync(sourcePath).size <= MAX_SOURCE_BYTES,
      `${item.id} source exceeds 5 MiB`,
    );

    if (item.thumbnailPath) {
      const thumbnailPath = resolve(WEB_PUBLIC_ROOT, item.thumbnailPath);
      assert.ok(
        thumbnailPath.startsWith(`${WEB_PUBLIC_ROOT}${sep}`),
        `${item.id} thumbnail escaped web public root`,
      );
      assert.equal(
        existsSync(thumbnailPath),
        true,
        `${item.id} declared thumbnail is not materialized`,
      );
    }
  }
});

test("catalog intentionally excludes over-budget and heavyweight research scenes", () => {
  const curatedIds: readonly string[] = CURATED_GALLERY_IDS;
  assert.equal(curatedIds.includes("billion_atom_block"), false);
  assert.equal(curatedIds.includes("massive_1m"), false);
  assert.equal(curatedIds.includes("hfc_r32_research"), false);
  assert.equal(curatedIds.includes("hfc_r125_research"), false);
});

test("search covers names, formulas, domains, tags, and multiple terms", () => {
  assert.deepEqual(
    filterGalleryItems(CURATED_GALLERY, "aspirin", "all").map(
      (item) => item.id,
    ),
    ["aspirin"],
  );
  assert.deepEqual(
    filterGalleryItems(CURATED_GALLERY, "C8H10N4O2", "all").map(
      (item) => item.id,
    ),
    ["caffeine"],
  );
  assert.ok(
    filterGalleryItems(CURATED_GALLERY, "nanomaterials", "all").some(
      (item) => item.id === "cnt_6_6",
    ),
  );
  assert.deepEqual(
    filterGalleryItems(CURATED_GALLERY, "metallic glass", "all").map(
      (item) => item.id,
    ),
    ["cuzr_melt"],
  );
  assert.deepEqual(
    filterGalleryItems(CURATED_GALLERY, "not-a-real-structure", "all"),
    [],
  );
  assert.equal(
    filterGalleryItems(CURATED_GALLERY, "   ", "all").length,
    CURATED_GALLERY.length,
  );
});

test("native filters are complete and preserve category semantics", () => {
  assert.deepEqual(
    GALLERY_FILTERS.map((option) => option.id),
    ["all", "featured", "molecules", "materials", "trajectories"],
  );
  assert.ok(
    filterGalleryItems(CURATED_GALLERY, "", "featured").every(
      (item) => item.featured,
    ),
  );
  assert.ok(
    filterGalleryItems(CURATED_GALLERY, "", "molecules").every(
      (item) => item.category === "molecule",
    ),
  );
  assert.ok(
    filterGalleryItems(CURATED_GALLERY, "", "materials").every(
      (item) => item.category === "material",
    ),
  );
  assert.ok(
    filterGalleryItems(CURATED_GALLERY, "", "trajectories").every(
      (item) => item.frameCount > 1,
    ),
  );
  assert.deepEqual(
    filterGalleryItems(CURATED_GALLERY, "water", "trajectories").map(
      (item) => item.id,
    ),
    ["this_is_water"],
  );
  assert.equal(galleryFilterCount("all"), CURATED_GALLERY.length);
});

test("gallery presentation partitions discovery sections without dropping or duplicating IDs", () => {
  const presentation = selectGalleryPresentation(CURATED_GALLERY, "", "all");
  const presentedIds = [...presentation.featured, ...presentation.catalog].map(
    (item) => item.id,
  );

  assert.equal(presentation.resultCount, CURATED_GALLERY.length);
  assert.ok(presentation.featured.length > 0);
  assert.equal(presentation.featured[0]?.id, "caffeine");
  assert.ok(presentation.featured.every((item) => item.featured === true));
  assert.ok(presentation.catalog.every((item) => item.featured !== true));
  assert.equal(new Set(presentedIds).size, CURATED_GALLERY.length);
  assert.deepEqual([...presentedIds].sort(), [...CURATED_GALLERY_IDS].sort());
});

test("search and category refinements collapse into one complete results section", () => {
  const search = selectGalleryPresentation(CURATED_GALLERY, "caffeine", "all");
  assert.deepEqual(search.featured, []);
  assert.deepEqual(
    search.catalog.map((item) => item.id),
    ["caffeine"],
  );
  assert.equal(search.resultCount, 1);

  const featured = selectGalleryPresentation(CURATED_GALLERY, "", "featured");
  assert.deepEqual(featured.featured, []);
  assert.ok(featured.catalog.length > 0);
  assert.ok(featured.catalog.every((item) => item.featured === true));
  assert.equal(featured.resultCount, featured.catalog.length);
});

test("thumbnail URLs stay on the configured trusted origin", () => {
  const aspirin = CURATED_GALLERY.find((item) => item.id === "aspirin");
  const caffeine = CURATED_GALLERY.find((item) => item.id === "caffeine");
  assert.ok(aspirin);
  assert.ok(caffeine);
  assert.equal(
    galleryThumbnailUrl(aspirin, "https://lupi.live"),
    "https://lupi.live/gallery/snapshots/aspirin.jpg",
  );
  assert.equal(galleryThumbnailUrl(caffeine, "https://lupi.live"), null);
});

function parseCanonicalCount(value: string | undefined): number {
  const digits = value?.replace(/[^0-9]/g, "") ?? "";
  return digits ? Number(digits) : 0;
}
