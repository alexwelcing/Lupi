import { useGlobalShortcuts } from './useGlobalShortcuts';

export function GlobalShortcuts({ commandPaletteOpen, setCommandPaletteOpen }: {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}) {
  useGlobalShortcuts(commandPaletteOpen, setCommandPaletteOpen);
  return null;
}
