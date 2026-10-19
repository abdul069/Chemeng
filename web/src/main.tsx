import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/figtree/700.css";
import "@fontsource/young-serif/400.css";
import "./styles.css";
import { App } from "./App";
import { DataProvider } from "./store";
import { TimerProvider } from "./components/Timers";
import { applyTheme } from "./theme";

applyTheme();

import { setupNative } from "./native";
void setupNative();
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DataProvider>
      <TimerProvider>
        <App />
      </TimerProvider>
    </DataProvider>
  </StrictMode>,
);
