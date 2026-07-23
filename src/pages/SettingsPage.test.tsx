import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import type { DisplayDensity } from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  afterEach(cleanup);

  it("changes the device-only display density", async () => {
    const repository = new FakePreferencesRepository();
    render(
      <PreferencesProvider repository={repository}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    expect(await screen.findByRole("radio", { name: "Default" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "Compact" }));

    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
    expect(repository.writes).toEqual(["compact"]);
  });

  it("uses its fieldset legend as the only named density group", async () => {
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    expect(await screen.findByRole("group", { name: "표시 밀도" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("keeps a visible focus treatment while changing density with the keyboard", async () => {
    const repository = new FakePreferencesRepository();
    const user = userEvent.setup();
    render(
      <PreferencesProvider repository={repository}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    const defaultRadio = await screen.findByRole("radio", { name: "Default" });
    const defaultLabel = screen.getByText("Default").closest("label");

    await user.tab();

    expect(defaultRadio).toHaveFocus();
    expect(defaultLabel).toHaveClass("peer-focus-visible:outline-2");
    expect(defaultLabel).toHaveClass(
      "peer-focus-visible:outline-[var(--color-primary)]",
    );
    expect(defaultLabel).toHaveClass("peer-focus-visible:outline-offset-2");

    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
    await waitFor(() => expect(repository.writes).toEqual(["compact"]));
  });

  it("disables density choices while the initial preference read is pending", () => {
    const repository: PreferencesRepository = {
      getDisplayDensity: () => new Promise<DisplayDensity>(() => {}),
      setDisplayDensity: async () => {},
    };
    render(
      <PreferencesProvider repository={repository}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    expect(screen.getByRole("radio", { name: "Default" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Compact" })).toBeDisabled();
  });
});
