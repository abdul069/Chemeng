import type { CapacitorConfig } from "@capacitor/cli";

// De Android-app laadt de live Kinday-server, zodat elke update meteen in de app zit.
// Eigen server? Zet GEZINSBORD_URL (bv. http://192.168.1.20:8080) vóór `npm run android:sync`.
const url = process.env.GEZINSBORD_URL || "https://gezinsbord-production-69b1.up.railway.app";

const config: CapacitorConfig = {
  appId: "be.gezinsbord.app",
  appName: "Kinday",
  webDir: "dist",
  server: { url, cleartext: url.startsWith("http://"), androidScheme: "https" },
  android: { allowMixedContent: true, backgroundColor: "#e8f6f3" },
  plugins: { LocalNotifications: { smallIcon: "ic_stat_ezan", iconColor: "#2bb3a8", sound: "ezan.wav" } },
};

export default config;
