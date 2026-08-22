import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { ViewerScreen } from "@/src/features/viewer/viewer-screen";
import { colors } from "@/src/theme/colors";

import {
  MAX_IMPORTED_XYZ_BYTES,
  validateXyzDocument,
  type ValidatedXyzDocument,
} from "./xyz-document";

interface ImportedDocument extends ValidatedXyzDocument {
  name: string;
}

export function ImportMoleculeScreen() {
  const [document, setDocument] = useState<ImportedDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseFile = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: "*/*",
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) throw new Error("No document was selected.");
      if (!asset.name.toLowerCase().endsWith(".xyz")) {
        throw new Error("Choose a file with the .xyz extension.");
      }
      const file = new File(asset.uri);
      const fileSize = asset.size ?? file.size;
      if (fileSize > MAX_IMPORTED_XYZ_BYTES) {
        throw new Error(
          "Choose an XYZ file smaller than 2 MB for this mobile preview.",
        );
      }

      const validated = validateXyzDocument(await file.text());
      if (process.env.EXPO_OS === "ios")
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      setDocument({ ...validated, name: asset.name });
    } catch (cause) {
      if (process.env.EXPO_OS === "ios")
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(
        cause instanceof Error
          ? cause.message
          : "Lupi could not read this file.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (document) {
    return (
      <ViewerScreen
        displayName={`${document.name} · ${document.atomCount.toLocaleString()} atoms`}
        initialMolecule={{ inputType: "xyz", input: document.text }}
      />
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        padding: 22,
      }}
      style={{ backgroundColor: colors.background }}
    >
      <View
        style={{
          backgroundColor: colors.backgroundElevated,
          borderColor: colors.border,
          borderCurve: "continuous",
          borderRadius: 26,
          borderWidth: 1,
          gap: 16,
          padding: 22,
        }}
      >
        <Text
          selectable
          style={{
            color: colors.accent,
            fontSize: 13,
            fontWeight: "900",
            letterSpacing: 1.1,
          }}
        >
          ON-DEVICE IMPORT
        </Text>
        <Text
          selectable
          style={{
            color: colors.text,
            fontSize: 30,
            fontWeight: "900",
            letterSpacing: -0.8,
          }}
        >
          Open your own structure.
        </Text>
        <Text
          selectable
          style={{ color: colors.textMuted, fontSize: 16, lineHeight: 23 }}
        >
          Pick an XYZ file from Files or iCloud Drive. Lupi validates it on your
          iPhone, then sends the text directly to the molecular viewer.
        </Text>
        <Text
          selectable
          style={{ color: colors.warning, fontSize: 13, lineHeight: 19 }}
        >
          Lupi renders this structure with its secure viewer service. Imported
          coordinates enter that viewer in memory, so open only data you are
          allowed to process there.
        </Text>
        <View
          style={{
            backgroundColor: colors.card,
            borderCurve: "continuous",
            borderRadius: 16,
            gap: 5,
            padding: 14,
          }}
        >
          <Text
            selectable
            style={{ color: colors.text, fontSize: 14, fontWeight: "800" }}
          >
            Mobile safety profile
          </Text>
          <Text
            selectable
            style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}
          >
            XYZ only · 2 MB maximum · 50,000 atoms maximum
          </Text>
        </View>
        {error ? (
          <Text
            accessibilityRole="alert"
            selectable
            style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}
          >
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => void chooseFile()}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: pressed ? colors.accentStrong : colors.accent,
            borderCurve: "continuous",
            borderRadius: 15,
            justifyContent: "center",
            minHeight: 52,
            opacity: loading ? 0.7 : 1,
          })}
        >
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text
              style={{
                color: colors.background,
                fontSize: 16,
                fontWeight: "900",
              }}
            >
              Choose XYZ File
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}
