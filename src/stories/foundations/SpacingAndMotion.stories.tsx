import { useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@/components/ui/button";

const meta = {
  title: "Foundations/Spacing & Motion",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const spacingTokens = [
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-8",
  "--space-10",
  "--space-12",
] as const;

const radiusTokens = [
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-full",
] as const;

function FocusPreview() {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return <Button ref={buttonRef} variant="secondary">포커스 예시</Button>;
}

function MotionPreview() {
  const motionStyle = {
    "--demo-background": "var(--color-primary-soft)",
    "--demo-background-hover": "var(--color-primary-soft-pressed)",
  } as CSSProperties & Record<"--demo-background" | "--demo-background-hover", string>;

  return (
    <>
      <style>
        {`
          .foundation-motion-preview {
            transition:
              background-color var(--motion-control-duration) var(--motion-control-easing),
              color var(--motion-control-duration) var(--motion-control-easing);
          }

          .foundation-motion-preview:hover {
            background-color: var(--demo-background-hover);
            color: var(--color-primary-text);
          }

          @media (prefers-reduced-motion: reduce) {
            .foundation-motion-preview {
              transition: none;
            }
          }
        `}
      </style>
      <div
        className="foundation-motion-preview inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--font-ui-size)] leading-[var(--font-ui-line)] text-[var(--color-text-default)]"
        style={{
          ...motionStyle,
          backgroundColor: "var(--demo-background)",
        }}
      >
        reduced-motion-safe transition
      </div>
    </>
  );
}

export const ReferenceScale: Story = {
  render: () => (
    <div className="min-h-screen bg-[var(--color-canvas)] p-[var(--space-8)] text-[var(--color-text-default)]">
      <div className="mx-auto grid max-w-6xl gap-[var(--space-6)]">
        <section className="grid gap-[var(--space-3)]">
          <h2 className="text-[length:var(--font-section-size)] font-[number:var(--font-weight-section-title)] leading-[var(--font-section-line)] text-[var(--color-text-strong)]">
            4px spacing scale
          </h2>
          <div className="grid gap-[var(--space-2)]">
            {spacingTokens.map((token) => (
              <div key={token} className="grid gap-[var(--space-1)]">
                <div className="text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">
                  {token}
                </div>
                <div
                  className="h-[var(--space-3)] rounded-[var(--radius-full)] bg-[var(--color-primary-action)]"
                  style={{ width: `var(${token})` }}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-[var(--space-3)]">
          <h2 className="text-[length:var(--font-section-size)] font-[number:var(--font-weight-section-title)] leading-[var(--font-section-line)] text-[var(--color-text-strong)]">
            Radius
          </h2>
          <div className="grid gap-[var(--space-3)] md:grid-cols-2 xl:grid-cols-4">
            {radiusTokens.map((token) => (
              <article
                key={token}
                className="grid gap-[var(--space-2)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]"
                style={{ borderRadius: `var(${token})` }}
              >
                <div className="text-[length:var(--font-group-size)] font-[number:var(--font-weight-control)] leading-[var(--font-group-line)] text-[var(--color-text-strong)]">
                  {token}
                </div>
                <p className="text-[length:var(--font-ui-size)] leading-[var(--font-ui-line)] text-[var(--color-text-muted)]">
                  Controls and surfaces inherit this token directly.
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-[var(--space-3)]">
          <h2 className="text-[length:var(--font-section-size)] font-[number:var(--font-weight-section-title)] leading-[var(--font-section-line)] text-[var(--color-text-strong)]">
            Overlay elevation
          </h2>
          <div className="rounded-[var(--radius-lg)] bg-[var(--color-overlay)] p-[var(--space-6)]">
            <div className="max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)] shadow-[var(--shadow-overlay)]">
              Tooltip, dropdown, dialog and popover use overlay-only depth.
            </div>
          </div>
        </section>

        <section className="grid gap-[var(--space-3)]">
          <h2 className="text-[length:var(--font-section-size)] font-[number:var(--font-weight-section-title)] leading-[var(--font-section-line)] text-[var(--color-text-strong)]">
            Focus example
          </h2>
          <FocusPreview />
        </section>

        <section className="grid gap-[var(--space-3)]">
          <h2 className="text-[length:var(--font-section-size)] font-[number:var(--font-weight-section-title)] leading-[var(--font-section-line)] text-[var(--color-text-strong)]">
            Motion
          </h2>
          <MotionPreview />
        </section>
      </div>
    </div>
  ),
};
