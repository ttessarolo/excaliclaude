// ExcaliClaude — Scene hash helper.
//
// Cheap fingerprint of the current Excalidraw scene so the client can tell
// Claude "nothing changed since last turn, skip describe_scene". We hash only
// (id, version, versionNonce) of every non-deleted element: Excalidraw bumps
// these on any mutation, so this is both stable and minimal.

type ElementLike = {
  id: string;
  version?: number;
  versionNonce?: number;
  isDeleted?: boolean;
};

export async function hashScene(
  elements: readonly ElementLike[] | null | undefined,
): Promise<string> {
  const seed = (elements || [])
    .filter((e) => e && !e.isDeleted)
    .map((e) => `${e.id}:${e.version ?? 0}:${e.versionNonce ?? 0}`)
    .join('|');
  if (!seed) return 'empty';
  try {
    const bytes = new TextEncoder().encode(seed);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // Fallback (non-HTTPS / older webview): simple FNV-1a 32-bit.
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }
}
