/**
 * Azgaar Mode Joueur — first isolated UI scaffold.
 * This module is intentionally not wired into the app yet.
 * It keeps player-mode code separate while the integration points are reviewed.
 */
export type PlayerModeState = {
  enabled: boolean;
  selectedStateId: number | null;
};

export const PlayerMode = {
  state: { enabled: false, selectedStateId: null } as PlayerModeState,

  toggle(): void {
    this.state.enabled = !this.state.enabled;
  },

  reset(): void {
    this.state = { enabled: false, selectedStateId: null };
  }
};
