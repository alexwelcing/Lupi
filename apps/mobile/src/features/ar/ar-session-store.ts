import type { MoleculeArScene } from "./ar-scene";

const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_MAX_SESSIONS = 3;

interface ArSessionRecord {
  createdAt: number;
  scene: MoleculeArScene;
}

export class ArSessionRepository {
  private sequence = 0;
  private readonly sessions = new Map<string, ArSessionRecord>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_SESSION_TTL_MS,
    private readonly maximumSessions = DEFAULT_MAX_SESSIONS,
  ) {}

  create(scene: MoleculeArScene): string {
    this.prune();
    this.sequence = (this.sequence + 1) % Number.MAX_SAFE_INTEGER;
    const id = `ar-${this.now().toString(36)}-${this.sequence.toString(36)}`;
    this.sessions.set(id, { createdAt: this.now(), scene });
    while (this.sessions.size > this.maximumSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }
    return id;
  }

  read(id: string | undefined): MoleculeArScene | null {
    if (!id || !/^ar-[a-z0-9]+-[a-z0-9]+$/.test(id)) return null;
    this.prune();
    return this.sessions.get(id)?.scene ?? null;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, record] of this.sessions) {
      if (record.createdAt <= cutoff) this.sessions.delete(id);
    }
  }
}

const arSessions = new ArSessionRepository();

export function createArSession(scene: MoleculeArScene): string {
  return arSessions.create(scene);
}

export function readArSession(id: string | undefined): MoleculeArScene | null {
  return arSessions.read(id);
}

export function removeArSession(id: string): void {
  arSessions.remove(id);
}
