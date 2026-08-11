import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { colors } from "@/src/theme/colors";

import {
  atomDistanceAngstrom,
  type MoleculeArAtom,
  type MoleculeArScene,
} from "./ar-scene";
import { checkMoleculeArSupport, requestMoleculeArCamera } from "./ar-runtime";
import {
  MoleculeArSurface,
  type MoleculeArSurfaceState,
} from "./molecule-ar-surface";

type ArScreenPhase =
  | "intro"
  | "checking"
  | "active"
  | "permission-denied"
  | "unsupported";

const INITIAL_SURFACE_STATE: MoleculeArSurfaceState = {
  placed: false,
  planeCount: 0,
  tracking: "initializing",
};

export function ArScreen({ scene }: { scene: MoleculeArScene | null }) {
  const insets = useSafeAreaInsets();
  const mounted = useRef(true);
  const [phase, setPhase] = useState<ArScreenPhase>("intro");
  const [message, setMessage] = useState<string | null>(null);
  const [surfaceState, setSurfaceState] = useState(INITIAL_SURFACE_STATE);
  const [resetToken, setResetToken] = useState(0);
  const [selectedAtomIndices, setSelectedAtomIndices] = useState<number[]>([]);
  const [atomInspectorOpen, setAtomInspectorOpen] = useState(false);

  const selectedAtoms = useMemo(
    () =>
      selectedAtomIndices
        .map((index) => scene?.atoms[index])
        .filter((atom): atom is MoleculeArAtom => atom !== undefined),
    [scene, selectedAtomIndices],
  );

  const startRoomView = async () => {
    if (!scene) return;
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      setMessage(
        "Native AR needs the Lupi development build. Expo Go cannot load the ARKit renderer.",
      );
      setPhase("unsupported");
      return;
    }

    setMessage(null);
    setPhase("checking");
    const support = await checkMoleculeArSupport();
    if (!mounted.current) return;
    if (!support.supported) {
      setMessage(
        support.message ?? "Native room view is not supported on this device.",
      );
      setPhase("unsupported");
      return;
    }

    const cameraGranted = await requestMoleculeArCamera();
    if (!mounted.current) return;
    if (!cameraGranted) {
      setMessage(
        "Camera access is required to find surfaces and place the molecule in your room.",
      );
      setPhase("permission-denied");
      return;
    }

    setSurfaceState(INITIAL_SURFACE_STATE);
    setSelectedAtomIndices([]);
    setPhase("active");
  };

  const handleSurfaceState = useCallback((next: MoleculeArSurfaceState) => {
    setSurfaceState((current) =>
      current.placed === next.placed &&
      current.planeCount === next.planeCount &&
      current.tracking === next.tracking
        ? current
        : next,
    );
  }, []);

  const handleAtomSelected = useCallback((atom: MoleculeArAtom) => {
    void Haptics.selectionAsync();
    setSelectedAtomIndices((current) => nextAtomSelection(current, atom.index));
  }, []);

  const handleSurfaceError = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
  }, []);

  const replaceMolecule = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAtomIndices([]);
    setSurfaceState((current) => ({ ...current, placed: false }));
    setResetToken((current) => current + 1);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!scene) {
    return (
      <ArRecoveryState
        message="This private AR session has expired. Return to the molecule and choose Room again."
        title="Room view expired"
      />
    );
  }

  if (phase !== "active") {
    return (
      <View
        collapsable={false}
        style={{ backgroundColor: colors.background, flex: 1 }}
        testID="ar-room-intro"
      >
        <StatusBar style="light" />
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom: Math.max(insets.bottom, 24),
            paddingHorizontal: 20,
            paddingTop: Math.max(insets.top, 16),
          }}
          contentInsetAdjustmentBehavior="never"
        >
          <View style={{ flex: 1 }}>
            <Pressable
              accessibilityLabel="Close room view"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => ({
                alignItems: "center",
                alignSelf: "flex-start",
                backgroundColor: pressed ? colors.cardPressed : colors.card,
                borderCurve: "continuous",
                borderRadius: 15,
                height: 44,
                justifyContent: "center",
                width: 44,
              })}
            >
              <SymbolView name="xmark" size={17} tintColor={colors.text} />
            </Pressable>
            <View
              style={{
                flex: 1,
                gap: 24,
                justifyContent: "center",
                paddingVertical: 28,
              }}
            >
              <View
                style={{
                  alignItems: "center",
                  alignSelf: "flex-start",
                  backgroundColor: "rgba(111,231,247,0.12)",
                  borderCurve: "continuous",
                  borderRadius: 20,
                  height: 64,
                  justifyContent: "center",
                  width: 64,
                }}
              >
                <SymbolView name="arkit" size={31} tintColor={colors.accent} />
              </View>
              <View style={{ gap: 9 }}>
                <Text
                  accessibilityRole="header"
                  selectable
                  style={{
                    color: colors.text,
                    fontSize: 32,
                    fontWeight: "800",
                    letterSpacing: -0.8,
                    lineHeight: 38,
                  }}
                >
                  Place {scene.molecule.name} in your room
                </Text>
                <Text
                  selectable
                  style={{
                    color: colors.textMuted,
                    fontSize: 16,
                    lineHeight: 23,
                  }}
                >
                  See the structure at room scale, move around it, and inspect
                  atoms with touch.
                </Text>
              </View>
              <View style={{ gap: 15 }}>
                <RoomInstruction
                  icon="viewfinder"
                  text="Scan a table, floor, or wall"
                />
                <RoomInstruction
                  icon="hand.tap.fill"
                  text="Tap the blue surface to place"
                />
                <RoomInstruction
                  icon="hand.draw.fill"
                  text="Drag, pinch, rotate, and tap atoms to inspect"
                />
              </View>
              <View
                style={{
                  alignItems: "flex-start",
                  backgroundColor: colors.card,
                  borderCurve: "continuous",
                  borderRadius: 16,
                  flexDirection: "row",
                  gap: 11,
                  padding: 14,
                }}
              >
                <SymbolView
                  name="lock.shield.fill"
                  size={18}
                  style={{ height: 22, width: 22 }}
                  tintColor={colors.success}
                />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 14,
                      fontWeight: "700",
                    }}
                  >
                    Camera privacy
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: colors.textMuted,
                      fontSize: 13,
                      lineHeight: 18,
                    }}
                  >
                    Camera images stay on this iPhone and are used only to find
                    surfaces and anchor the molecule.
                  </Text>
                </View>
              </View>
              {message ? (
                <View
                  style={{
                    alignItems: "flex-start",
                    backgroundColor: "rgba(255,141,156,0.12)",
                    borderCurve: "continuous",
                    borderRadius: 14,
                    flexDirection: "row",
                    gap: 9,
                    padding: 12,
                  }}
                >
                  <SymbolView
                    name="exclamationmark.circle.fill"
                    size={17}
                    style={{ height: 20, width: 20 }}
                    tintColor={colors.danger}
                  />
                  <Text
                    accessibilityRole="alert"
                    selectable
                    style={{
                      color: "#FFD3DA",
                      flex: 1,
                      fontSize: 14,
                      lineHeight: 20,
                    }}
                  >
                    {message}
                  </Text>
                </View>
              ) : null}
              {phase === "checking" ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: 10,
                    minHeight: 50,
                  }}
                >
                  <ActivityIndicator color={colors.accent} />
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 15,
                      fontWeight: "600",
                    }}
                  >
                    Checking this iPhone…
                  </Text>
                </View>
              ) : null}
            </View>
            {phase === "checking" ? null : (
              <View style={{ gap: 10 }}>
                {phase === "permission-denied" ? (
                  <PrimaryButton
                    icon="gearshape.fill"
                    label="Open iPhone Settings"
                    onPress={() => void Linking.openSettings()}
                  />
                ) : phase === "unsupported" ? null : (
                  <PrimaryButton
                    icon="camera.fill"
                    label="Start Room View"
                    onPress={() => void startRoomView()}
                  />
                )}
                {phase === "permission-denied" ? (
                  <SecondaryButton
                    label="Try Again"
                    onPress={() => void startRoomView()}
                  />
                ) : null}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  const guidance = roomGuidance(surfaceState);
  return (
    <View
      style={{ backgroundColor: "#000000", flex: 1 }}
      testID="ar-room-screen"
    >
      <StatusBar style="light" />
      <MoleculeArSurface
        onAtomSelected={handleAtomSelected}
        onError={handleSurfaceError}
        onStateChange={handleSurfaceState}
        resetToken={resetToken}
        scene={scene}
        selectedAtomIndices={selectedAtomIndices}
      />
      <View
        pointerEvents="box-none"
        style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
      >
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: 9,
            justifyContent: "space-between",
            paddingHorizontal: 12,
            paddingTop: Math.max(insets.top + 8, 16),
          }}
        >
          <RoundOverlayButton
            accessibilityLabel="Close room view"
            icon="xmark"
            onPress={() => router.back()}
          />
          <View
            style={{
              backgroundColor: "rgba(7,17,24,0.74)",
              borderCurve: "continuous",
              borderRadius: 15,
              flex: 1,
              maxWidth: 290,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: colors.text,
                fontSize: 14,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              {scene.molecule.name}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                color: colors.textMuted,
                fontSize: 11,
                fontVariant: ["tabular-nums"],
                textAlign: "center",
              }}
            >
              {scene.molecule.atomCount.toLocaleString()} atoms · Native room
              view
            </Text>
          </View>
          <RoundOverlayButton
            accessibilityLabel="Place molecule again"
            icon="arrow.counterclockwise"
            onPress={replaceMolecule}
          />
        </View>

        <View
          style={{
            alignItems: "center",
            paddingHorizontal: 18,
            paddingTop: 12,
          }}
        >
          <View
            accessibilityLiveRegion="polite"
            style={{
              alignItems: "center",
              backgroundColor: "rgba(7,17,24,0.76)",
              borderCurve: "continuous",
              borderRadius: 14,
              flexDirection: "row",
              gap: 8,
              maxWidth: 340,
              paddingHorizontal: 13,
              paddingVertical: 9,
            }}
          >
            <View
              accessibilityElementsHidden
              style={{
                backgroundColor:
                  surfaceState.tracking === "normal"
                    ? colors.accent
                    : colors.warning,
                borderRadius: 4,
                height: 7,
                width: 7,
              }}
            />
            <Text
              style={{
                color: colors.text,
                fontSize: 13,
                fontWeight: "600",
                flexShrink: 1,
                textAlign: "center",
              }}
            >
              {guidance}
            </Text>
          </View>
        </View>

        <View
          pointerEvents="box-none"
          style={{
            bottom: Math.max(insets.bottom + 10, 18),
            left: 12,
            position: "absolute",
            right: 12,
          }}
        >
          <View style={{ gap: 10 }}>
            {message ? (
              <View
                style={{
                  alignItems: "flex-start",
                  backgroundColor: "rgba(91,24,38,0.92)",
                  borderCurve: "continuous",
                  borderRadius: 15,
                  flexDirection: "row",
                  gap: 9,
                  padding: 12,
                }}
              >
                <SymbolView
                  name="exclamationmark.circle.fill"
                  size={16}
                  style={{ height: 19, width: 19 }}
                  tintColor={colors.danger}
                />
                <Text
                  accessibilityRole="alert"
                  selectable
                  style={{
                    color: "#FFD3DA",
                    flex: 1,
                    fontSize: 13,
                    lineHeight: 18,
                  }}
                >
                  {message}
                </Text>
              </View>
            ) : null}
            {selectedAtoms.length ? (
              <AtomSelectionCard
                atoms={selectedAtoms}
                onClear={() => setSelectedAtomIndices([])}
              />
            ) : surfaceState.placed ? (
              <View
                style={{
                  alignItems: "center",
                  backgroundColor: "rgba(7,17,24,0.76)",
                  borderCurve: "continuous",
                  borderRadius: 15,
                  flexDirection: "row",
                  gap: 9,
                  justifyContent: "center",
                  padding: 12,
                }}
              >
                <SymbolView
                  name="hand.tap.fill"
                  size={16}
                  tintColor={colors.accent}
                />
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 12,
                    lineHeight: 17,
                    textAlign: "center",
                  }}
                >
                  Tap an atom to inspect it. Tap a second atom to measure their
                  distance.
                </Text>
              </View>
            ) : null}
            <AtomInspectorButton
              atomCount={scene.atoms.length}
              onPress={() => setAtomInspectorOpen(true)}
              selectedCount={selectedAtomIndices.length}
            />
          </View>
        </View>
      </View>
      <AtomInspectorSheet
        atoms={scene.atoms}
        moleculeName={scene.molecule.name}
        onClear={() => setSelectedAtomIndices([])}
        onClose={() => setAtomInspectorOpen(false)}
        onSelect={handleAtomSelected}
        selectedAtomIndices={selectedAtomIndices}
        visible={atomInspectorOpen}
      />
    </View>
  );
}

function AtomInspectorButton({
  atomCount,
  onPress,
  selectedCount,
}: {
  atomCount: number;
  onPress: () => void;
  selectedCount: number;
}) {
  const selectionDetail = selectedCount
    ? `, ${selectedCount} ${selectedCount === 1 ? "atom" : "atoms"} selected`
    : "";
  return (
    <Pressable
      accessibilityHint="Opens a list where you can inspect atoms and measure a pair without touching the 3D scene"
      accessibilityLabel={`Inspect all ${atomCount.toLocaleString()} atoms${selectionDetail}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? "rgba(22,49,61,0.96)" : "rgba(7,17,24,0.86)",
        borderCurve: "continuous",
        borderRadius: 15,
        flexDirection: "row",
        gap: 10,
        minHeight: 48,
        paddingHorizontal: 14,
        paddingVertical: 8,
      })}
      testID="ar-atom-inspector-button"
    >
      <SymbolView
        accessibilityElementsHidden
        name="list.bullet"
        size={17}
        style={{ height: 20, width: 20 }}
        tintColor={colors.accent}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>
          Inspect atoms
        </Text>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 11,
            fontVariant: ["tabular-nums"],
          }}
        >
          {selectedCount
            ? `${selectedCount} selected · choose or measure`
            : `${atomCount.toLocaleString()} available · accessible list`}
        </Text>
      </View>
      <SymbolView
        accessibilityElementsHidden
        name="chevron.up"
        size={13}
        style={{ height: 16, width: 13 }}
        tintColor={colors.textMuted}
      />
    </Pressable>
  );
}

function AtomInspectorSheet({
  atoms,
  moleculeName,
  onClear,
  onClose,
  onSelect,
  selectedAtomIndices,
  visible,
}: {
  atoms: MoleculeArAtom[];
  moleculeName: string;
  onClear: () => void;
  onClose: () => void;
  onSelect: (atom: MoleculeArAtom) => void;
  selectedAtomIndices: number[];
  visible: boolean;
}) {
  const selectedAtoms = selectedAtomIndices
    .map((index) => atoms[index])
    .filter((atom): atom is MoleculeArAtom => atom !== undefined);
  const selectionSummary = atomInspectorSelectionSummary(selectedAtoms);
  const selectFromList = (atom: MoleculeArAtom) => {
    const nextSelection = nextAtomSelection(selectedAtomIndices, atom.index);
    const nextAtoms = nextSelection
      .map((index) => atoms[index])
      .filter((nextAtom): nextAtom is MoleculeArAtom => nextAtom !== undefined);
    onSelect(atom);
    setTimeout(() => {
      AccessibilityInfo.announceForAccessibility(
        atomInspectorSelectionSummary(nextAtoms),
      );
    }, 80);
  };

  return (
    <Modal
      accessibilityViewIsModal
      allowSwipeDismissal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      testID="ar-atom-inspector-sheet"
      visible={visible}
    >
      <SafeAreaView
        edges={["top", "bottom"]}
        style={{ backgroundColor: colors.background, flex: 1 }}
      >
        <View
          style={{
            alignItems: "center",
            borderBottomColor: colors.border,
            borderBottomWidth: 1,
            flexDirection: "row",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              accessibilityRole="header"
              selectable
              style={{ color: colors.text, fontSize: 21, fontWeight: "800" }}
            >
              Inspect atoms
            </Text>
            <Text
              selectable
              style={{
                color: colors.textMuted,
                fontSize: 12,
                fontVariant: ["tabular-nums"],
              }}
            >
              {moleculeName} · {atoms.length.toLocaleString()} atoms
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close atom inspector"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: pressed ? colors.cardPressed : colors.card,
              borderCurve: "continuous",
              borderRadius: 15,
              height: 44,
              justifyContent: "center",
              width: 44,
            })}
          >
            <SymbolView
              accessibilityElementsHidden
              name="xmark"
              size={15}
              tintColor={colors.text}
            />
          </Pressable>
        </View>

        <FlatList
          accessibilityLabel={`Atoms in ${moleculeName}`}
          contentContainerStyle={{
            paddingBottom: 32,
            paddingHorizontal: 16,
            paddingTop: 16,
          }}
          contentInsetAdjustmentBehavior="automatic"
          data={atoms}
          initialNumToRender={12}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          keyExtractor={(atom) => String(atom.index)}
          ListHeaderComponent={
            <View style={{ gap: 12, paddingBottom: 16 }}>
              <Text
                selectable
                style={{
                  color: colors.textMuted,
                  fontSize: 14,
                  lineHeight: 20,
                }}
              >
                Choose one atom to inspect it. Choose a second atom to measure
                the distance between them. Choosing another atom starts a new
                measurement.
              </Text>
              <View
                style={{
                  alignItems: "center",
                  backgroundColor: colors.card,
                  borderCurve: "continuous",
                  borderRadius: 16,
                  flexDirection: "row",
                  gap: 10,
                  minHeight: 52,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                }}
              >
                <Text
                  accessibilityLiveRegion="polite"
                  selectable
                  style={{
                    color: selectedAtoms.length
                      ? colors.text
                      : colors.textMuted,
                    flex: 1,
                    fontSize: 14,
                    lineHeight: 20,
                  }}
                >
                  {selectionSummary}
                </Text>
                {selectedAtoms.length ? (
                  <Pressable
                    accessibilityLabel="Clear selected atoms"
                    accessibilityRole="button"
                    onPress={onClear}
                    style={({ pressed }) => ({
                      alignItems: "center",
                      borderCurve: "continuous",
                      borderRadius: 12,
                      justifyContent: "center",
                      minHeight: 44,
                      opacity: pressed ? 0.62 : 1,
                      paddingHorizontal: 8,
                    })}
                  >
                    <Text
                      style={{
                        color: colors.accent,
                        fontSize: 14,
                        fontWeight: "700",
                      }}
                    >
                      Clear
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          }
          maxToRenderPerBatch={16}
          renderItem={({ item: atom }) => {
            const selectionOrder = selectedAtomIndices.indexOf(atom.index);
            const selected = selectionOrder >= 0;
            const coordinates = atom.positionAngstrom.map(formatArCoordinate);
            const accessibilitySelection = selected
              ? `, selected ${selectionOrder + 1} of ${selectedAtomIndices.length}`
              : "";
            const accessibilityHint = selected
              ? selectedAtomIndices.length === 2
                ? "Starts a new measurement from this atom"
                : "Keeps this atom selected"
              : selectedAtomIndices.length === 1
                ? "Selects this as the second atom and announces their distance"
                : selectedAtomIndices.length === 2
                  ? "Starts a new measurement from this atom"
                  : "Selects this atom for inspection";
            return (
              <Pressable
                accessibilityHint={accessibilityHint}
                accessibilityLabel={`Atom ${atom.index + 1}, ${atom.name}, symbol ${atom.element}, atomic number ${atom.atomicNumber}, position x ${coordinates[0]}, y ${coordinates[1]}, z ${coordinates[2]} angstroms${accessibilitySelection}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => selectFromList(atom)}
                style={({ pressed }) => ({
                  alignItems: "center",
                  backgroundColor: pressed
                    ? colors.cardPressed
                    : selected
                      ? "rgba(111,231,247,0.12)"
                      : colors.card,
                  borderColor: selected ? colors.accentStrong : "transparent",
                  borderCurve: "continuous",
                  borderRadius: 16,
                  borderWidth: 1,
                  flexDirection: "row",
                  gap: 12,
                  minHeight: 68,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                })}
              >
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    alignItems: "center",
                    backgroundColor: colors.cardPressed,
                    borderCurve: "continuous",
                    borderRadius: 14,
                    gap: 3,
                    height: 44,
                    justifyContent: "center",
                    width: 44,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: atom.color,
                      borderRadius: 4,
                      height: 8,
                      width: 8,
                    }}
                  />
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 12,
                      fontWeight: "800",
                    }}
                  >
                    {atom.element}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                  <Text
                    selectable
                    style={{
                      color: colors.text,
                      fontSize: 16,
                      fontWeight: "700",
                    }}
                  >
                    {atom.name} {atom.index + 1}
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: colors.textMuted,
                      fontSize: 12,
                      fontVariant: ["tabular-nums"],
                      lineHeight: 17,
                    }}
                  >
                    Atomic number {atom.atomicNumber} · x {coordinates[0]}, y{" "}
                    {coordinates[1]}, z {coordinates[2]} Å
                  </Text>
                </View>
                <SymbolView
                  accessibilityElementsHidden
                  name={selected ? "checkmark.circle.fill" : "circle"}
                  size={20}
                  style={{ height: 22, width: 22 }}
                  tintColor={selected ? colors.accent : colors.textMuted}
                />
              </Pressable>
            );
          }}
          showsVerticalScrollIndicator={false}
          style={{ backgroundColor: colors.background }}
          windowSize={7}
        />
      </SafeAreaView>
    </Modal>
  );
}

function RoomInstruction({ icon, text }: { icon: SFSymbol; text: string }) {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 13,
        minHeight: 44,
      }}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.card,
          borderCurve: "continuous",
          borderRadius: 13,
          height: 40,
          justifyContent: "center",
          width: 40,
        }}
      >
        <SymbolView name={icon} size={18} tintColor={colors.accent} />
      </View>
      <Text
        selectable
        style={{ color: colors.text, flex: 1, fontSize: 15, lineHeight: 21 }}
      >
        {text}
      </Text>
    </View>
  );
}

function AtomSelectionCard({
  atoms,
  onClear,
}: {
  atoms: MoleculeArAtom[];
  onClear: () => void;
}) {
  const distance =
    atoms.length === 2 ? atomDistanceAngstrom(atoms[0], atoms[1]) : null;
  return (
    <View
      style={{
        backgroundColor: "rgba(7,17,24,0.86)",
        borderCurve: "continuous",
        borderRadius: 18,
        gap: 5,
        paddingHorizontal: 16,
        paddingVertical: 13,
      }}
    >
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: 10,
          justifyContent: "space-between",
        }}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
            {atoms.map((atom) => `${atom.name} ${atom.index + 1}`).join(" ↔ ")}
          </Text>
          <Text selectable style={{ color: colors.textMuted, fontSize: 12 }}>
            {distance === null
              ? `${atoms[0].element} · atomic number ${atoms[0].atomicNumber}`
              : `${atoms[0].element}${atoms[0].index + 1}–${atoms[1].element}${atoms[1].index + 1} · ${distance.toFixed(3)} Å`}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Clear atom selection"
          accessibilityRole="button"
          onPress={onClear}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: pressed ? colors.cardPressed : colors.card,
            borderCurve: "continuous",
            borderRadius: 15,
            height: 44,
            justifyContent: "center",
            width: 44,
          })}
        >
          <SymbolView name="xmark" size={14} tintColor={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

function ArRecoveryState({
  message,
  title,
}: {
  message: string;
  title: string;
}) {
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{ backgroundColor: colors.background, flex: 1 }}
    >
      <StatusBar style="light" />
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
        }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View
          style={{
            alignSelf: "center",
            backgroundColor: colors.backgroundElevated,
            borderCurve: "continuous",
            borderRadius: 24,
            gap: 12,
            maxWidth: 520,
            padding: 22,
            width: "100%",
          }}
        >
          <Text
            accessibilityRole="header"
            selectable
            style={{ color: colors.text, fontSize: 25, fontWeight: "800" }}
          >
            {title}
          </Text>
          <Text
            selectable
            style={{ color: colors.textMuted, fontSize: 15, lineHeight: 22 }}
          >
            {message}
          </Text>
          <PrimaryButton
            icon="chevron.backward"
            label="Return to Molecule"
            onPress={() => router.back()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PrimaryButton({
  icon,
  label,
  onPress,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.accentStrong : colors.accent,
        borderRadius: 16,
        flexDirection: "row",
        gap: 8,
        justifyContent: "center",
        minHeight: 52,
        paddingHorizontal: 18,
        paddingVertical: 10,
      })}
    >
      <SymbolView name={icon} size={18} tintColor={colors.background} />
      <Text
        style={{
          color: colors.background,
          flexShrink: 1,
          fontSize: 16,
          fontWeight: "700",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.cardPressed : colors.card,
        borderRadius: 16,
        justifyContent: "center",
        minHeight: 48,
        paddingHorizontal: 18,
      })}
    >
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function RoundOverlayButton({
  accessibilityLabel,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  icon: SFSymbol;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? "rgba(22,49,61,0.96)" : "rgba(7,17,24,0.82)",
        borderRadius: 22,
        height: 44,
        justifyContent: "center",
        width: 44,
      })}
    >
      <SymbolView name={icon} size={17} tintColor={colors.text} />
    </Pressable>
  );
}

function nextAtomSelection(current: number[], atomIndex: number): number[] {
  return current.length === 1 && current[0] !== atomIndex
    ? [current[0], atomIndex]
    : [atomIndex];
}

function atomInspectorSelectionSummary(atoms: MoleculeArAtom[]): string {
  if (!atoms.length) return "No atoms selected.";
  if (atoms.length === 1) {
    return `${atoms[0].name} ${atoms[0].index + 1} selected. Choose another atom to measure.`;
  }
  return `${atoms[0].name} ${atoms[0].index + 1} to ${atoms[1].name} ${atoms[1].index + 1}: ${atomDistanceAngstrom(atoms[0], atoms[1]).toFixed(3)} angstroms.`;
}

function formatArCoordinate(value: number): string {
  return Math.abs(value) < 0.0005 ? "0.000" : value.toFixed(3);
}

function roomGuidance(state: MoleculeArSurfaceState): string {
  if (state.tracking === "unavailable")
    return "Move slowly and point the camera at a well-lit surface.";
  if (state.tracking === "limited")
    return "Keep moving slowly so Lupi can understand the room.";
  if (state.placed) return "Placed · drag, pinch, rotate, or tap an atom";
  if (state.planeCount > 0) return "Surface found · tap the blue area to place";
  return "Move your iPhone slowly to find a table, floor, or wall";
}
