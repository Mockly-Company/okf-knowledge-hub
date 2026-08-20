import * as React from "react";

export interface FormFieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  description?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
}

interface FormControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
}

export function FormField({
  label,
  htmlFor,
  description,
  error,
  children,
}: FormFieldProps) {
  const generatedId = React.useId();
  const controlId = htmlFor ?? `field-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const child = React.Children.only(children);

  if (!React.isValidElement<FormControlProps>(child)) {
    throw new Error("FormField requires one valid form control child.");
  }

  const describedBy = [
    child.props["aria-describedby"],
    descriptionId,
    errorId,
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  const control = React.cloneElement<FormControlProps>(child, {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : child.props["aria-invalid"],
  });

  return (
    <div className="grid gap-[var(--space-2)]">
      <label
        htmlFor={controlId}
        className="font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]"
      >
        {label}
      </label>
      {description ? (
        <p
          id={descriptionId}
          className="m-0 font-[number:var(--font-weight-description)] text-[var(--color-text-muted)]"
        >
          {description}
        </p>
      ) : null}
      {control}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="m-0 font-[number:var(--font-weight-description)] text-[var(--color-error)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
