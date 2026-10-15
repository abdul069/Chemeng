import type { CapacitorConfig } from "@capacitor/cli";

// De Android-app toont de Gezinsbord-server uit je thuisnetwerk.
// Zet GEZINSBORD_URL op het adres van je server, bv. http://192.168.1.20:8080, vóór `npm run android:sync`.
const url = process.env.GEZINSBORD_URL;

const config: CapacitorConfig = {
  appId: "be.gezinsbord.app",
  appName: "Gezinsbord",
  webDir: "dist",
  server: url ? { url, cleartext: url.startsWith("http://") } : undefined,
  android: { allowMixedContent: true },
};

export default config;
