import { ELEMENT_DATA } from "@atlas/core/elements";
import {
  ViroAmbientLight,
  ViroARPlaneSelector,
  ViroARScene,
  ViroARSceneNavigator,
  ViroDirectionalLight,
  ViroMaterials,
  ViroNode,
  ViroPinchStateTypes,
  ViroPolyline,
  ViroQuad,
  ViroRotateStateTypes,
  ViroSphere,
  ViroTrackingStateConstants,
  type ViroAnchor,
  type ViroTrackingReason,
  type ViroTrackingState,
} from "@reactvision/react-viro";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";

import type { ArVector3, MoleculeArScene } from "./ar-scene";
import type {
  MoleculeArSurfaceProps,
  MoleculeArSurfaceState,
  MoleculeArTrackingState,
} from "./molecule-ar-surface.types";

const LIGHT_MASK = 2;
const BOND_MATERIAL = "lupi_ar_bond";
const SELECTED_MATERIAL = "lupi_ar_selected";
const SHADOW_MATERIAL = "lupi_ar_shadow";

let materialsRegistered = false;

type ViroRoomProps = MoleculeArSurfaceProps;

interface ViroSceneNavigatorContract {
  viroAppProps: ViroRoomProps;
}

interface ViroRoomSceneProps {
  sceneNavigator: ViroSceneNavigatorContract;
}

export function MoleculeArSurface(props: MoleculeArSurfaceProps) {
  registerMaterials();
  const {
    onAtomSelected,
    onError,
    onStateChange,
    resetToken,
    scene,
    selectedAtomIndices,
  } = props;
  const viroAppProps = useMemo(
    () => ({
      onAtomSelected,
      onError,
      onStateChange,
      resetToken,
      scene,
      selectedAtomIndices,
    }),
    [
      onAtomSelected,
      onError,
      onStateChange,
      resetToken,
      scene,
      selectedAtomIndices,
    ],
  );

  return (
    <ViroARSceneNavigator
      autofocus
      bloomEnabled
      hdrEnabled
      initialScene={MOLECULE_ROOM_SCENE}
      initialSceneKey={`lupi-ar-${scene.source.moleculeKey}`}
      multisamplingEnabled
      occlusionMode="peopleOnly"
      pbrEnabled
      provider="none"
      shadowsEnabled
      style={styles.fill}
      viroAppProps={viroAppProps}
      worldAlignment="Gravity"
    />
  );
}

// Viro injects sceneNavigator at runtime, although its public initialScene type
// still describes a zero-argument component.
const MOLECULE_ROOM_SCENE = {
  scene: MoleculeRoomScene as unknown as () => ReturnType<
    typeof MoleculeRoomScene
  >,
};

function MoleculeRoomScene({ sceneNavigator }: ViroRoomSceneProps) {
  const {
    onAtomSelected,
    onError,
    onStateChange,
    resetToken,
    scene,
    selectedAtomIndices,
  } = sceneNavigator.viroAppProps;
  const selectorRef = useRef<ViroARPlaneSelector>(null);
  const knownPlanes = useRef(new Set<string>());
  const selectedPlaneId = useRef<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const [tracking, setTracking] =
    useState<MoleculeArTrackingState>("initializing");
  const [position, setPosition] = useState<ArVector3>(() =>
    initialModelPosition(scene),
  );
  const [scale, setScale] = useState(1);
  const [rotationY, setRotationY] = useState(0);
  const pinchStartScale = useRef(1);
  const rotateStartDegrees = useRef(0);
  const state = useMemo<MoleculeArSurfaceState>(
    () => ({ placed, planeCount: knownPlanes.current.size, tracking }),
    [placed, tracking],
  );

  useEffect(() => onStateChange(state), [onStateChange, state]);

  useEffect(() => {
    selectorRef.current?.reset();
    knownPlanes.current.clear();
    selectedPlaneId.current = null;
    setPlaced(false);
    setPosition(initialModelPosition(scene));
    setScale(1);
    setRotationY(0);
  }, [resetToken, scene]);

  const reportPlaneCount = () => {
    onStateChange({
      placed,
      planeCount: knownPlanes.current.size,
      tracking,
    });
  };

  const onAnchorFound = (anchor: ViroAnchor) => {
    selectorRef.current?.handleAnchorFound(anchor);
    if (anchor.type === "plane") {
      knownPlanes.current.add(anchor.anchorId);
      reportPlaneCount();
    }
  };

  const onAnchorUpdated = (anchor: ViroAnchor) => {
    selectorRef.current?.handleAnchorUpdated(anchor);
  };

  const onAnchorRemoved = (anchor?: ViroAnchor) => {
    if (!anchor) return;
    selectorRef.current?.handleAnchorRemoved(anchor);
    knownPlanes.current.delete(anchor.anchorId);
    const removedSelectedPlane = selectedPlaneId.current === anchor.anchorId;
    if (removedSelectedPlane) {
      selectedPlaneId.current = null;
      setPlaced(false);
    }
    onStateChange({
      placed: removedSelectedPlane ? false : placed,
      planeCount: knownPlanes.current.size,
      tracking,
    });
  };

  const onTrackingUpdated = (
    nativeState: ViroTrackingState,
    _reason: ViroTrackingReason,
  ) => {
    const next = trackingStateFromViro(nativeState);
    setTracking(next);
  };

  const onPinch = (pinchState: number, scaleFactor: number) => {
    if (pinchState === ViroPinchStateTypes.PINCH_START) {
      pinchStartScale.current = scale;
    }
    if (
      pinchState === ViroPinchStateTypes.PINCH_MOVE ||
      pinchState === ViroPinchStateTypes.PINCH_END
    ) {
      setScale(clamp(pinchStartScale.current * scaleFactor, 0.35, 4));
    }
  };

  const onRotate = (rotateState: number, rotationFactor: number) => {
    if (rotateState === ViroRotateStateTypes.ROTATE_START) {
      rotateStartDegrees.current = rotationY;
    }
    if (
      rotateState === ViroRotateStateTypes.ROTATE_MOVE ||
      rotateState === ViroRotateStateTypes.ROTATE_END
    ) {
      setRotationY(rotateStartDegrees.current + rotationFactor);
    }
  };

  return (
    <ViroARScene
      anchorDetectionTypes={["planesHorizontal", "planesVertical"]}
      onAnchorFound={onAnchorFound}
      onAnchorRemoved={onAnchorRemoved}
      onAnchorUpdated={onAnchorUpdated}
      onError={(event) =>
        onError(
          event.nativeEvent?.error?.message ??
            "The native AR scene reported an error.",
        )
      }
      onTrackingUpdated={onTrackingUpdated}
    >
      <ViroAmbientLight
        color="#F2FBFF"
        intensity={420}
        influenceBitMask={LIGHT_MASK}
      />
      <ViroDirectionalLight
        castsShadow
        color="#FFFFFF"
        direction={[-0.4, -1, -0.3]}
        influenceBitMask={LIGHT_MASK}
        intensity={650}
        shadowFarZ={4}
        shadowMapSize={1024}
        shadowNearZ={0.1}
        shadowOpacity={0.42}
        shadowOrthographicPosition={[0, 1.4, 0]}
        shadowOrthographicSize={1.2}
      />
      <ViroARPlaneSelector
        alignment="Both"
        hideOverlayOnSelection
        minHeight={0.14}
        minWidth={0.14}
        onPlaneSelected={(plane) => {
          selectedPlaneId.current = plane.anchorId;
          setPlaced(true);
          onStateChange({
            placed: true,
            planeCount: knownPlanes.current.size,
            tracking,
          });
        }}
        ref={selectorRef}
        useActualShape
      >
        <ViroNode
          dragPlane={{
            maxDistance: 5,
            planeNormal: [0, 1, 0],
            planePoint: [0, 0, 0],
          }}
          dragType="FixedToPlane"
          onDrag={(nextPosition) =>
            setPosition([
              nextPosition[0],
              initialModelPosition(scene)[1],
              nextPosition[2],
            ])
          }
          onPinch={onPinch}
          onRotate={onRotate}
          position={position}
          rotation={[0, rotationY, 0]}
          scale={[scale, scale, scale]}
        >
          <ViroQuad
            arShadowReceiver
            height={0.5}
            materials={[SHADOW_MATERIAL]}
            position={[0, -position[1] + 0.001, 0]}
            rotation={[-90, 0, 0]}
            width={0.5}
          />
          {scene.bonds.map((bond) => (
            <ViroPolyline
              key={`bond-${bond.a}-${bond.b}`}
              lightReceivingBitMask={LIGHT_MASK}
              materials={[BOND_MATERIAL]}
              points={[
                scene.atoms[bond.a].positionMeters,
                scene.atoms[bond.b].positionMeters,
              ]}
              thickness={0.006}
            />
          ))}
          {scene.atoms.map((atom) => (
            <ViroSphere
              key={`atom-${atom.index}`}
              heightSegmentCount={12}
              lightReceivingBitMask={LIGHT_MASK}
              materials={[
                selectedAtomIndices.includes(atom.index)
                  ? SELECTED_MATERIAL
                  : elementMaterialName(atom.element),
              ]}
              onClick={() => onAtomSelected(atom)}
              position={atom.positionMeters}
              radius={atom.radiusMeters}
              shadowCastingBitMask={LIGHT_MASK}
              widthSegmentCount={16}
            />
          ))}
        </ViroNode>
      </ViroARPlaneSelector>
    </ViroARScene>
  );
}

function registerMaterials(): void {
  if (materialsRegistered) return;
  materialsRegistered = true;
  ViroMaterials.createMaterials({
    ...Object.fromEntries(
      Object.values(ELEMENT_DATA).map((element) => [
        elementMaterialName(element.symbol),
        {
          diffuseColor: element.color,
          lightingModel: "Blinn",
          shininess: 0.45,
        },
      ]),
    ),
    [BOND_MATERIAL]: {
      diffuseColor: "#B7C6CC",
      lightingModel: "Blinn",
      shininess: 0.25,
    },
    [SELECTED_MATERIAL]: {
      diffuseColor: "#7CF4FF",
      lightingModel: "Blinn",
      shininess: 0.8,
    },
    [SHADOW_MATERIAL]: {
      blendMode: "Alpha",
      diffuseColor: "rgba(255,255,255,0.01)",
      lightingModel: "Constant",
      writesToDepthBuffer: false,
    },
  });
}

function elementMaterialName(element: string): string {
  return `lupi_ar_element_${element.toLowerCase()}`;
}

function initialModelPosition(scene: MoleculeArScene): ArVector3 {
  return [0, Math.max(0.035, scene.extentMeters[1] / 2 + 0.018), 0];
}

function trackingStateFromViro(
  state: ViroTrackingState,
): MoleculeArTrackingState {
  if (state === ViroTrackingStateConstants.TRACKING_NORMAL) return "normal";
  if (state === ViroTrackingStateConstants.TRACKING_LIMITED) return "limited";
  return "unavailable";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
