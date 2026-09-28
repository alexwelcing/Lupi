# pmndrs `math` micro-benchmarks (indicative)

These are the scripts behind the Node numbers quoted in [pmndrs-math.md](pmndrs-math.md) §4 and the report's performance ledger. They ran once in a single container on Node 22 (V8): median of 25 timed runs after warm-up. They were not run on any browser or device, so treat every figure as indicative only.

To reproduce: put the files below in an empty folder, run `npm i math@0.1.0 three@0.184.0 gl-matrix@3 maath@0.10.8 rollup @rollup/plugin-node-resolve @rollup/plugin-terser`, then `node bench.mjs` for timings and `npx rollup -c` for the tree-shaken bundle sizes of each entry.

## `bench.mjs`

```js
// Indicative local micro-benchmarks: math@0.1.0 vs three@0.184 vs gl-matrix@3 vs maath@0.10.8.
// Node 22 (V8), single container, median of RUNS timed runs after warmup. Not authoritative.
import { mat4 as mmat4, quat as mquat } from 'math';
import { frustum as mfrustum } from 'math/shapes';
import { spring } from 'math/time';
import { simplex3d, curl3 } from 'math/noise';
import { mulberry32 } from 'math/random';
import * as THREE from 'three';
import { mat4 as gmat4 } from 'gl-matrix';
import { easing as measing } from 'maath/dist/maath.esm.js';
import { noise as mnoise } from 'maath/random/dist/maath-random.esm.js';

const RUNS = 25;
let __idx = -1;
function bench(name, setup, fn) {
    __idx++;
    if (process.env.B !== undefined && Number(process.env.B) !== __idx) return;
    const ctx = setup();
    for (let i = 0; i < 10; i++) fn(ctx);
    const times = [];
    let sink = 0;
    for (let r = 0; r < RUNS; r++) {
        const t0 = performance.now();
        sink += fn(ctx) || 0;
        times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)];
    console.log(`${name.padEnd(58)} median ${(med * 1000).toFixed(0).padStart(7)} us   (sink ${Number.isFinite(sink) ? 'ok' : 'nan'})`);
    return med;
}

const rng = mulberry32.create(42);
const R = () => mulberry32.sample(rng);

// ---------- A. instanced compose, 10k instances ----------
const N = 10000;
function makeInst() {
    const pos = new Float32Array(N * 3), rot = new Float32Array(N * 4), scl = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
        pos[i * 3] = R() * 10; pos[i * 3 + 1] = R() * 10; pos[i * 3 + 2] = R() * 10;
        const q = mquat.create(); mquat.setAxisAngle(q, [0, 1, 0], R() * 6); rot.set(q, i * 4);
        scl[i * 3] = scl[i * 3 + 1] = scl[i * 3 + 2] = 0.5 + R();
    }
    const mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), N);
    return { pos, rot, scl, mesh, buf: mesh.instanceMatrix.array };
}
console.log('\nA. instanced transforms, 10k instances (compose TRS -> instanceMatrix)');
bench('three: Object3D dummy + updateMatrix + setMatrixAt', makeInst, (c) => {
    const d = c.dummy || (c.dummy = new THREE.Object3D());
    for (let i = 0; i < N; i++) {
        d.position.set(c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]);
        d.quaternion.set(c.rot[i * 4], c.rot[i * 4 + 1], c.rot[i * 4 + 2], c.rot[i * 4 + 3]);
        d.scale.set(c.scl[i * 3], c.scl[i * 3 + 1], c.scl[i * 3 + 2]);
        d.updateMatrix();
        c.mesh.setMatrixAt(i, d.matrix);
    }
    return c.buf[5];
});
bench('three: Matrix4.compose + setMatrixAt', makeInst, (c) => {
    const m = c.m || (c.m = new THREE.Matrix4()), p = c.p || (c.p = new THREE.Vector3()), q = c.q || (c.q = new THREE.Quaternion()), s = c.s || (c.s = new THREE.Vector3());
    for (let i = 0; i < N; i++) {
        p.set(c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]);
        q.set(c.rot[i * 4], c.rot[i * 4 + 1], c.rot[i * 4 + 2], c.rot[i * 4 + 3]);
        s.set(c.scl[i * 3], c.scl[i * 3 + 1], c.scl[i * 3 + 2]);
        m.compose(p, q, s);
        c.mesh.setMatrixAt(i, m);
    }
    return c.buf[5];
});
bench('math: fromRotationTranslationScale (plain tuples) + buf.set', makeInst, (c) => {
    const m = mmat4.create(), p = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1];
    for (let i = 0; i < N; i++) {
        p[0] = c.pos[i * 3]; p[1] = c.pos[i * 3 + 1]; p[2] = c.pos[i * 3 + 2];
        q[0] = c.rot[i * 4]; q[1] = c.rot[i * 4 + 1]; q[2] = c.rot[i * 4 + 2]; q[3] = c.rot[i * 4 + 3];
        s[0] = c.scl[i * 3]; s[1] = c.scl[i * 3 + 1]; s[2] = c.scl[i * 3 + 2];
        mmat4.fromRotationTranslationScale(m, q, p, s);
        c.buf.set(m, i * 16);
    }
    return c.buf[5];
});
bench('math: fromRotationTranslationScale into subarray views', (() => { const c = makeInst(); c.views = []; for (let i = 0; i < N; i++) c.views.push(c.buf.subarray(i * 16, i * 16 + 16)); return () => c; })(), (c) => {
    const p = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1];
    for (let i = 0; i < N; i++) {
        p[0] = c.pos[i * 3]; p[1] = c.pos[i * 3 + 1]; p[2] = c.pos[i * 3 + 2];
        q[0] = c.rot[i * 4]; q[1] = c.rot[i * 4 + 1]; q[2] = c.rot[i * 4 + 2]; q[3] = c.rot[i * 4 + 3];
        s[0] = c.scl[i * 3]; s[1] = c.scl[i * 3 + 1]; s[2] = c.scl[i * 3 + 2];
        mmat4.fromRotationTranslationScale(c.views[i], q, p, s);
    }
    return c.buf[5];
});
bench('gl-matrix: fromRotationTranslationScale + buf.set', makeInst, (c) => {
    const m = gmat4.create(), p = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1];
    for (let i = 0; i < N; i++) {
        p[0] = c.pos[i * 3]; p[1] = c.pos[i * 3 + 1]; p[2] = c.pos[i * 3 + 2];
        q[0] = c.rot[i * 4]; q[1] = c.rot[i * 4 + 1]; q[2] = c.rot[i * 4 + 2]; q[3] = c.rot[i * 4 + 3];
        s[0] = c.scl[i * 3]; s[1] = c.scl[i * 3 + 1]; s[2] = c.scl[i * 3 + 2];
        gmat4.fromRotationTranslationScale(m, q, p, s);
        c.buf.set(m, i * 16);
    }
    return c.buf[5];
});

// ---------- B. frustum vs spheres, 50k ----------
const NS = 50000;
function makeSpheres() {
    const cam = new THREE.PerspectiveCamera(50, 1.5, 0.1, 100);
    cam.position.set(0, 0, 30); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const centers = new Float32Array(NS * 3);
    for (let i = 0; i < NS * 3; i++) centers[i] = (R() - 0.5) * 60;
    return { cam, centers };
}
console.log('\nB. frustum culling, 50k bounding spheres (radius 0.5)');
bench('three: Frustum.setFromProjectionMatrix + intersectsSphere', makeSpheres, (c) => {
    const f = new THREE.Frustum(), m = new THREE.Matrix4(), sp = new THREE.Sphere(new THREE.Vector3(), 0.5);
    m.multiplyMatrices(c.cam.projectionMatrix, c.cam.matrixWorldInverse); f.setFromProjectionMatrix(m);
    let vis = 0;
    for (let i = 0; i < NS; i++) { sp.center.set(c.centers[i * 3], c.centers[i * 3 + 1], c.centers[i * 3 + 2]); if (f.intersectsSphere(sp)) vis++; }
    return vis;
});
bench('math: frustum.setFromViewProjectionMatrixNO + intersectsSphere', makeSpheres, (c) => {
    const f = c.f || (c.f = mfrustum.create()); const sp = c.sp || (c.sp = { center: [0, 0, 0], radius: 0.5 });
    mfrustum.setFromViewProjectionMatrixNO(f, c.cam.projectionMatrix.elements, c.cam.matrixWorldInverse.elements);
    let vis = 0;
    for (let i = 0; i < NS; i++) { const ce = sp.center; ce[0] = c.centers[i * 3]; ce[1] = c.centers[i * 3 + 1]; ce[2] = c.centers[i * 3 + 2]; if (mfrustum.intersectsSphere(f, sp)) vis++; }
    return vis;
});

// ---------- C. springs, 100k scalars ----------
const NP = 100000;
console.log('\nC. 100k scalar springs, one frame step (dt = 1/60)');
bench('math: spring.damp (analytic, critically damped)', () => ({ s: Array.from({ length: NP }, () => spring.create(R())), t: Float64Array.from({ length: NP }, R) }), (c) => {
    for (let i = 0; i < NP; i++) spring.damp(c.s[i], c.t[i], 0.25, 1 / 60); return c.s[7].value;
});
bench('math: spring.update (dampingRatio 0.5, bouncy)', () => ({ s: Array.from({ length: NP }, () => spring.create(R())), t: Float64Array.from({ length: NP }, R) }), (c) => {
    for (let i = 0; i < NP; i++) spring.update(c.s[i], c.t[i], 0.25, 0.5, 1 / 60); return c.s[7].value;
});
bench('maath: easing.damp(obj, "v", target, 0.25, dt)', () => ({ s: Array.from({ length: NP }, () => ({ v: R() })), t: Float64Array.from({ length: NP }, R) }), (c) => {
    for (let i = 0; i < NP; i++) measing.damp(c.s[i], 'v', c.t[i], 0.25, 1 / 60); return c.s[7].v;
});

// ---------- D. noise ----------
const NN = 200000;
console.log('\nD. noise: 200k simplex3 samples; 50k curl3 evaluations');
bench('math: simplex3d.sample', () => ({ g: simplex3d.create(7) }), (c) => {
    let s = 0; for (let i = 0; i < NN; i++) s += simplex3d.sample(c.g, i * 0.013, i * 0.007, i * 0.011); return s;
});
bench('maath: random.noise.simplex3 (global seed)', () => { mnoise.seed(7); return {}; }, () => {
    let s = 0; for (let i = 0; i < NN; i++) s += mnoise.simplex3(i * 0.013, i * 0.007, i * 0.011); return s;
});
bench('math: curl3 over simplex3d (12 samples each), 50k', () => { const g = simplex3d.create(7); return { g, f: (x, y, z) => simplex3d.sample(g, x, y, z), o: [0, 0, 0] }; }, (c) => {
    let s = 0; for (let i = 0; i < 50000; i++) { curl3(c.o, c.f, i * 0.013, i * 0.007, i * 0.011); s += c.o[0]; } return s;
});
```

## `rollup.config.mjs`

```js
import resolve from '@rollup/plugin-node-resolve'; import terser from '@rollup/plugin-terser';
export default ['vec3only','spring3','simplex3-curl','quickhull3','frustum','core-all'].map(n=>({input:`entries/${n}.js`,output:{file:`rout/${n}.js`,format:'es'},plugins:[resolve(),terser()]}));
```

## `entries/all.js`

```js
import * as a from 'math'; import * as b from 'math/shapes'; import * as c from 'math/geometry'; import * as d from 'math/time'; import * as e from 'math/random'; import * as f from 'math/noise'; import * as g from 'math/color'; import * as h from 'math/ik'; console.log(a,b,c,d,e,f,g,h);
```

## `entries/core-all.js`

```js
import * as m from 'math'; console.log(m);
```

## `entries/frustum.js`

```js
import { frustum } from 'math/shapes';
const f=frustum.create(); console.log(frustum.intersectsSphere(f,{center:[0,0,0],radius:1}));
```

## `entries/glm-vec3.js`

```js
import { vec3 } from 'gl-matrix'; const o=vec3.create(); vec3.add(o,[1,2,3],[4,5,6]); vec3.normalize(o,o); console.log(o);
```

## `entries/maath-easing.js`

```js
import { damp3 } from 'maath/easing'; console.log(damp3);
```

## `entries/quickhull3.js`

```js
import { quickhull3 } from 'math/geometry';
console.log(quickhull3([0,0,0,1,0,0,0,1,0,0,0,1,1,1,1]));
```

## `entries/simplex3-curl.js`

```js
import { simplex3d, curl3 } from 'math/noise';
const g=simplex3d.create(1); const o=[0,0,0]; curl3(o,(x,y,z)=>simplex3d.sample(g,x,y,z),1,2,3); console.log(o);
```

## `entries/spring3.js`

```js
import { spring3 } from 'math/time';
const s=spring3.create(); spring3.update(s,[1,1,1],0.3,0.5,0.016); console.log(s);
```

## `entries/three-vector3.js`

```js
import { Vector3 } from 'three'; const o=new Vector3(1,2,3).add(new Vector3(4,5,6)).normalize(); console.log(o);
```

## `entries/vec3only.js`

```js
import { vec3 } from 'math';
const o=vec3.create(); vec3.add(o,[1,2,3],[4,5,6]); vec3.normalize(o,o); console.log(o);
```
