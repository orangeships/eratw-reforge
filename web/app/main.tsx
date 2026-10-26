import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { UiPreferencesBridge } from "./state/ui-preferences.js";
import "./styles.css";
import "./game/ascii/ascii-ui.css";
import "./game/responsive-ui.css";
import "./game/pre/opening.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UiPreferencesBridge />
    <App />
  </React.StrictMode>
);
