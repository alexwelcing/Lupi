export type SettingsRoute = "/import" | "/diagnostics";

export const INVALID_SAVED_VIEW_MESSAGE =
  "Enter a valid saved-view slug or lupi.live link.";

export type SettingsItem =
  | {
      kind: "route";
      id: "import-xyz" | "diagnostics";
      title: string;
      detail: string;
      icon: "folder" | "info.circle";
      route: SettingsRoute;
    }
  | {
      kind: "saved-view";
      id: "saved-view";
      title: string;
      detail: string;
    }
  | {
      kind: "privacy-note";
      id: "local-data" | "viewer-connection";
      title: string;
      detail: string;
      icon: "iphone" | "lock.shield";
    };

export interface SettingsSection {
  id: "open" | "privacy" | "about";
  title: string;
  data: SettingsItem[];
}

export function buildSettingsSections(): SettingsSection[] {
  return [
    {
      id: "open",
      title: "Open Content",
      data: [
        {
          kind: "route",
          id: "import-xyz",
          title: "Open XYZ File",
          detail: "Choose a molecular structure from Files or iCloud Drive.",
          icon: "folder",
          route: "/import",
        },
        {
          kind: "saved-view",
          id: "saved-view",
          title: "Open Saved View",
          detail:
            "Enter a Lupi slug or link to review before opening it in Safari.",
        },
      ],
    },
    {
      id: "privacy",
      title: "Privacy",
      data: [
        {
          kind: "privacy-note",
          id: "local-data",
          title: "On This iPhone",
          detail:
            "Recent structures stay on this device. Imported XYZ files are not added to Library history.",
          icon: "iphone",
        },
        {
          kind: "privacy-note",
          id: "viewer-connection",
          title: "Secure Viewing",
          detail:
            "Lupi loads only the structure you choose. Saved links open in Safari only after your confirmation.",
          icon: "lock.shield",
        },
      ],
    },
    {
      id: "about",
      title: "About",
      data: [
        {
          kind: "route",
          id: "diagnostics",
          title: "About & Diagnostics",
          detail:
            "App version, service status, privacy details, and a shareable report.",
          icon: "info.circle",
          route: "/diagnostics",
        },
      ],
    },
  ];
}
