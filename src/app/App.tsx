import { useState } from "react";
import { HashRouter } from "react-router-dom";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { createPreferencesRepository } from "@/infrastructure/preferences/createPreferencesRepository";
import { AppRoutes } from "./AppRoutes";

export function App() {
  const [repository] = useState(createPreferencesRepository);

  return (
    <PreferencesProvider repository={repository}>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </PreferencesProvider>
  );
}
