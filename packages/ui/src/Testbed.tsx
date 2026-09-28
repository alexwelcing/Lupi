import { Suspense, useState } from 'react';
import { OrbitControls, Grid } from '@react-three/drei/webgpu';
import { AtomsOptimized } from '@atlas/scene/AtomsOptimized';
import { Bonds } from '@atlas/scene/Bonds';
import { SimulationCell } from '@atlas/scene/SimulationCell';
import type { ColormapName, Frame } from '@atlas/core/types';
import { LupiCanvas } from './viewer/LupiCanvas';
import { detectRenderCapability } from './renderCapability';

// Mock frame data for visual testing
const mockFrame: Frame = {
  natoms: 10,
  timestep: 0,
  boxBounds: new Float64Array([-5, 5, -5, 5, -5, 5]),
  boxTilt: new Float64Array([0, 0, 0]),
  positions: new Float32Array([
    0, 0, 0,
    2, 0, 0,
    0, 2, 0,
    0, 0, 2,
    -2, 0, 0,
    0, -2, 0,
    0, 0, -2,
    2, 2, 0,
    -2, -2, 0,
    0, 2, 2
  ]),
  types: new Int32Array([1, 2, 1, 2, 1, 2, 1, 2, 1, 2]),
  ids: new Int32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  bonds: new Int32Array([1, 2, 3, 4]),
  triclinic: false,
  columns: ['id', 'type', 'x', 'y', 'z'],
  properties: new Map()
};

const mockTypeToElement = new Map([
  [1, 'C'],
  [2, 'O']
]);

// Fixed view settings. leva (zustand 4's `shallow` default export) does not
// build against the zustand 5 that fiber v10 and drei 11 require.
const colorPalette: ColormapName = 'ocean';
const showGrid = true;
const showBonds = true;
const showCell = true;

export function Testbed() {
  const [capability] = useState(detectRenderCapability);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#111' }}>
      <LupiCanvas
        id="lupi-testbed-canvas"
        capability={capability}
        frameloop="always"
        camera={{ position: [0, 5, 10], fov: 50 }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          
          {showGrid && <Grid infiniteGrid fadeDistance={20} cellColor="#444" sectionColor="#888" />}
          
          <group scale={0.5}>
            <AtomsOptimized
              frame={mockFrame}
              colormap={colorPalette}
            />
            {showBonds && (
              <Bonds
                frame={mockFrame}
                colormap={colorPalette}
                maxBondLength={3.0}
              />
            )}
            {showCell && mockFrame.boxBounds && (
              <SimulationCell 
                bounds={mockFrame.boxBounds} 
              />
            )}
          </group>
          
          <OrbitControls makeDefault />
        </Suspense>
      </LupiCanvas>
    </div>
  );
}
