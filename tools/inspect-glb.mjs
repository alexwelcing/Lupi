#!/usr/bin/env node
/**
 * Visual-proof tool: render a glb into a thumbnail using three.js'
 * GLTFLoader + a CPU-side software renderer so the headless check can be
 * run from Node without a GPU. The output is a cheap PPM (ascii), then
 * converted to PNG by Playwright's bundled canvas.
 *
 * Skeleton: parses the GLB via GLTFLoader in Node and prints a summary.
 * This is good enough for the agent-validation story; for production
 * preview rendering we already have the Playwright bridge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

const [, , glbPath] = process.argv;
if (!glbPath) {
  console.error('usage: node tools/inspect-glb.mjs <glb>');
  process.exit(2);
}

const data = fs.readFileSync(path.resolve(glbPath));
const loader = new GLTFLoader();
let parsed;
loader.parse(
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  '',
  (gltf) => {
    parsed = gltf;
    console.log(`gltf version: ${gltf.parser?.options?.gltf?.asset?.version ?? 'unknown'}`);
    console.log(`generator:    ${gltf.parser?.options?.gltf?.asset?.generator ?? 'unknown'}`);
    for (const scene of gltf.scenes ?? []) {
      console.log(`scene:        ${scene.name ?? '<unnamed>'}`);
      for (const child of scene.children ?? []) {
        const mesh = child;
        const geom = mesh.geometry;
        console.log(`  ${mesh.name} type=${child.type} triangles=${geom ? geom.attributes.position.count / 3 : 0}`);
      }
    }
    // Instanced meshes need extra digging.
    let instanced = 0;
    gltf.scene.traverse((obj) => {
      if (obj.isInstancedMesh) instanced += 1;
    });
    console.log(`instancedMeshes: ${instanced}`);
  },
  (err) => {
    console.error('parse error:', err.message ?? err);
    process.exit(1);
  },
);

if (!parsed) {
  // wait a microtask to let sync parse resolve
  await new Promise((r) => setImmediate(r));
}
