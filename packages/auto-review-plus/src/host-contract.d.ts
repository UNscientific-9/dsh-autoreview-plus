// The desktop runtime ships JavaScript without this peer's declarations.
// Keep only the value imported by the official gate; service calls are structural.
declare module '@deepseek-ai/dsh-permission-presets' {
  export const AUTO_PRESET: 'auto'
}
