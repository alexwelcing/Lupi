import { useLayoutEffect, useMemo, type MutableRefObject } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import { OrbitControls } from '@react-three/drei/webgpu';
import { AtomsOptimized, Bonds, LUPI_SHADER_TAG_KEY } from '@atlas/scene';
import { resolveTypeDisplayRadius, type Frame } from '@atlas/core';
import { Mesh, PerspectiveCamera, Vector3, type InstancedBufferGeometry, type Object3D } from 'three';
import { selectedAtomFrame, type MoleculeView } from './toolResult';

export interface CameraActions {
  zoom: (factor: number) => void;
  rotate: (horizontal: number, vertical: number) => void;
  snapshot: () => { position: number[]; target: number[] };
  sceneSnapshot: () => { atomLayerInstanceCounts: number[]; bondInstanceCount: number };
}

interface OrbitHandle {
  target: Vector3;
  update(): void;
}

/** Uses the same source-coordinate frame as Lupi's standalone viewer. */
function CameraFit({
  frame,
  is3d,
  resetVersion,
  actions,
}: {
  frame: Frame;
  is3d: boolean;
  resetVersion: number;
  actions: MutableRefObject<CameraActions | null>;
}) {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const controls = useThree((state) => state.controls) as OrbitHandle | null;
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);

  const bounds = useMemo(() => {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    const point = new Vector3();
    for (let index = 0; index < frame.natoms; index++) {
      point.fromArray(frame.positions, index * 3);
      min.min(point);
      max.max(point);
    }
    const center = min.add(max).multiplyScalar(0.5);
    let radius = 1;
    for (let index = 0; index < frame.natoms; index++) {
      point.fromArray(frame.positions, index * 3);
      const atomRadius = resolveTypeDisplayRadius(frame, frame.types[index]) * 3;
      radius = Math.max(radius, point.distanceTo(center) + atomRadius);
    }
    return { center, radius };
  }, [frame]);

  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || !controls || size.width <= 0 || size.height <= 0) return;
    const halfVertical = camera.fov * Math.PI / 360;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * size.width / size.height);
    const distance = bounds.radius * 1.12 / Math.sin(Math.min(halfVertical, halfHorizontal));
    const direction = is3d ? new Vector3(0.4, 0.28, 1).normalize() : new Vector3(0, 0, 1);
    camera.position.copy(bounds.center).addScaledVector(direction, distance);
    camera.near = Math.max(0.01, bounds.radius / 1000);
    camera.far = Math.max(100, distance * 20);
    camera.lookAt(bounds.center);
    camera.updateProjectionMatrix();
    controls.target.copy(bounds.center);
    controls.update();
    invalidate();
  }, [bounds, camera, controls, invalidate, is3d, resetVersion, size.width, size.height]);

  useLayoutEffect(() => {
    if (!controls) return;
    actions.current = {
      snapshot: () => ({ position: camera.position.toArray(), target: controls.target.toArray() }),
      sceneSnapshot: () => {
        const atomLayerInstanceCounts: number[] = [];
        let bondInstanceCount = 0;
        scene.traverse((object: Object3D) => {
          if (!(object instanceof Mesh) || !object.visible || Array.isArray(object.material)) return;
          const instances = (object.geometry as InstancedBufferGeometry).instanceCount;
          if (!Number.isFinite(instances)) return;
          const shader = object.material.userData[LUPI_SHADER_TAG_KEY];
          if (shader === 'atom-impostor') atomLayerInstanceCounts.push(instances);
          else if (shader === 'bond-impostor') bondInstanceCount += instances;
        });
        return { atomLayerInstanceCounts, bondInstanceCount };
      },
      zoom(factor) {
        const offset = camera.position.clone().sub(controls.target);
        const nextDistance = Math.max(bounds.radius * 0.5, Math.min(bounds.radius * 30, offset.length() * factor));
        camera.position.copy(controls.target).add(offset.setLength(nextDistance));
        controls.update();
        invalidate();
      },
      rotate(horizontal, vertical) {
        if (!is3d) return;
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(new Vector3(0, 1, 0), horizontal);
        const right = new Vector3().crossVectors(new Vector3(0, 1, 0), offset).normalize();
        offset.applyAxisAngle(right, vertical);
        camera.position.copy(controls.target).add(offset);
        controls.update();
        invalidate();
      },
    };
    return () => { actions.current = null; };
  }, [actions, bounds, camera, controls, invalidate, is3d, scene]);

  return null;
}

export function MoleculeScene({
  frame,
  view,
  is3d,
  resetVersion,
  actions,
}: {
  frame: Frame;
  view: MoleculeView;
  is3d: boolean;
  resetVersion: number;
  actions: MutableRefObject<CameraActions | null>;
}) {
  const highlighted = useMemo(() => selectedAtomFrame(frame, view.highlightAtomIds), [frame, view.highlightAtomIds]);
  const scale = view.style === 'spacefill' ? 2.8 : 1;
  const dimmed = Boolean(highlighted);

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 8, 10]} intensity={2} />
      <AtomsOptimized
        frame={frame}
        atomColorSource="element"
        colorMode={dimmed ? 'uniform' : 'type'}
        uniformColor="#52625b"
        scale={scale}
        materialPreset="matte"
        materialIntensity={0.5}
        rimLightIntensity={0.3}
        fillLightColor="#acbdd3"
        rimLightColor="#d5efe0"
        surfaceRoughness={0.22}
        qualityTier={1}
      />
      {highlighted && (
        <AtomsOptimized
          frame={highlighted}
          atomColorSource="element"
          scale={scale * 1.18}
          materialPreset="plastic"
          materialIntensity={0.4}
          rimLightIntensity={0.7}
          fillLightColor="#c8d6ff"
          rimLightColor="#ffffff"
          qualityTier={1}
        />
      )}
      {view.style === 'ball-and-stick' && frame.bonds.length > 0 && (
        <Bonds
          frame={frame}
          sourceKey={frame}
          inferenceAllowed={false}
          useGpu={false}
          periodic={false}
          atomColorSource="element"
          colorMode={dimmed ? 'uniform' : 'type'}
          uniformColor="#52625b"
          radius={0.105}
          opacity={1}
          materialPreset="matte"
          materialIntensity={0.4}
          qualityTier={1}
        />
      )}
      <OrbitControls
        makeDefault
        enablePan={false}
        enableRotate={is3d}
        enableZoom
        enableDamping
        dampingFactor={0.09}
        minDistance={1}
        maxDistance={500}
        rotateSpeed={0.7}
        zoomSpeed={0.8}
      />
      <CameraFit frame={frame} is3d={is3d} resetVersion={resetVersion} actions={actions} />
    </>
  );
}
