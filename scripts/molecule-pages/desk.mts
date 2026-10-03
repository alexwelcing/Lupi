/**
 * desk.mts — "Place on your desk": a small ball-and-stick model per molecule
 * page, as USDZ for AR Quick Look (iPhone, iPad) and GLB for Scene Viewer
 * (Android) and desktop 3D viewers. Built in Node with three's exporters (no
 * renderer, no browser): CPK spheres per element sharing one geometry, grey
 * bond cylinders sharing another, scaled so the molecule is about a hand's
 * width across and sitting on the surface it is placed on.
 *
 * Positions, elements and bonds are the page's own (catalog.mts), so the
 * model on the desk is the drawing on the page.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import type { MoleculeRecord } from './catalog.mts';

/** The molecule's widest turn on the desk (m). */
const DESK_SPAN_M = 0.18;
const MIN_M_PER_A = 0.004;
const MAX_M_PER_A = 0.05;
/** Atoms are drawn a little fuller in 3D than in ink. */
const ATOM_SCALE = 1.15;
const BOND_RADIUS_A = 0.12;
const BOND_COLOR = '#b9c1bc';

// GLTFExporter assembles the GLB through FileReader, which Node lacks.
function installFileReader(): void {
  const g = globalThis as unknown as { FileReader?: unknown };
  if (g.FileReader) return;
  g.FileReader = class {
    result: unknown = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onloadend?.();
      });
    }
  };
}

function buildScene(record: MoleculeRecord): THREE.Scene {
  const { model } = record;
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.name = record.id;
  scene.add(group);

  const metresPerA = Math.min(MAX_M_PER_A, Math.max(MIN_M_PER_A, DESK_SPAN_M / (2 * Math.max(0.5, model.radius))));
  const atomCount = model.k.length;
  const segments = atomCount > 150 ? [14, 10] : [24, 16];
  const sphere = new THREE.SphereGeometry(1, segments[0], segments[1]);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, atomCount > 150 ? 8 : 14, 1, true);

  const materials = model.kinds.map(
    (kind) =>
      new THREE.MeshStandardMaterial({
        name: `atom-${kind.s}`,
        color: new THREE.Color(kind.c),
        roughness: 0.38,
        metalness: 0.0,
      }),
  );
  const bondMaterial = new THREE.MeshStandardMaterial({
    name: 'bond',
    color: new THREE.Color(BOND_COLOR),
    roughness: 0.5,
    metalness: 0.0,
  });

  // Sit on the surface: the lowest atom's underside at y = 0.
  let minY = Infinity;
  for (let i = 0; i < atomCount; i += 1) {
    minY = Math.min(minY, model.p[3 * i + 1] - model.kinds[model.k[i]].r * ATOM_SCALE);
  }
  const at = (i: number) =>
    new THREE.Vector3(model.p[3 * i], model.p[3 * i + 1] - minY, model.p[3 * i + 2]).multiplyScalar(metresPerA);

  for (let i = 0; i < atomCount; i += 1) {
    const kind = model.kinds[model.k[i]];
    const mesh = new THREE.Mesh(sphere, materials[model.k[i]]);
    mesh.name = `${kind.s}${i + 1}`;
    mesh.position.copy(at(i));
    mesh.scale.setScalar(kind.r * ATOM_SCALE * metresPerA);
    group.add(mesh);
  }

  const up = new THREE.Vector3(0, 1, 0);
  for (let b = 0; b < model.b.length; b += 2) {
    const a = at(model.b[b]);
    const c = at(model.b[b + 1]);
    const axis = new THREE.Vector3().subVectors(c, a);
    const length = axis.length();
    if (length < 1e-6) continue;
    const mesh = new THREE.Mesh(cylinder, bondMaterial);
    mesh.name = `bond${b / 2 + 1}`;
    mesh.position.copy(a).addScaledVector(axis, 0.5);
    mesh.quaternion.setFromUnitVectors(up, axis.normalize());
    mesh.scale.set(BOND_RADIUS_A * metresPerA, length, BOND_RADIUS_A * metresPerA);
    group.add(mesh);
  }
  scene.updateMatrixWorld(true);
  return scene;
}

export interface DeskModels {
  usdz: Uint8Array;
  glb: Uint8Array;
}

export async function buildDeskModels(record: MoleculeRecord): Promise<DeskModels> {
  installFileReader();
  const scene = buildScene(record);
  const usdz = await new USDZExporter().parseAsync(scene, {
    quickLookCompatible: true,
    includeAnchoringProperties: true,
    ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
  });
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  return { usdz: new Uint8Array(usdz as unknown as ArrayBuffer), glb: new Uint8Array(glb) };
}
