import type { PropsWithChildren } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/patterns/AppShell";

/** Uses the production shell so page reviews include the real available width. */
export function PageStoryFrame({ children }: PropsWithChildren) {
  return <Routes><Route element={<AppShell />}><Route path="*" element={children} /></Route></Routes>;
}
