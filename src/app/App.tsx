import { useState } from "react";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { createPreferencesRepository } from "@/infrastructure/preferences/createPreferencesRepository";

export function App() {
  const [repository] = useState(createPreferencesRepository);

  return (
    <PreferencesProvider repository={repository}>
      <main aria-label="OkHub">OkHub</main>
    </PreferencesProvider>
  );
}
