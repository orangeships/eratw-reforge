/** Player-requested exclusions. Keep legacy handlers available to oracle tests,
 * but both the player menu and direct command intents must obey this policy. */
const DISABLED_PLAYER_COMMANDS: ReadonlySet<number> = new Set([95, 700, 702, 703]);

export function isPlayerDisabledCommand(commandNo: number): boolean {
  return DISABLED_PLAYER_COMMANDS.has(commandNo);
}
