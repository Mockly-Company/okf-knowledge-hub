import * as React from "react";

export interface FormFieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  description?: React.ReactNode;
  error?: React.ReactNode;
  /** Keep validation available to assistive technology without a visible message. */
  errorVisuallyHidden?: boolean;
  controlAction?: React.ReactNode;
  children: React.ReactNode;
}

interface FormControlProps {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
}

export function FormField({
  label,
  htmlFor,
  required,
  description,
  error,
  errorVisuallyHidden = false,
  controlAction,
  children,
}: FormFieldProps) {
  const generatedId = React.useId();
  const child = React.Children.only(children);

  if (!React.isValidElement<FormControlProps>(child)) {
    throw new Error("FormField requires one valid form control child.");
  }

  const controlId = htmlFor ?? child.props.id ?? `field-${generatedId}`;
  const isRequired = required || Boolean(child.props.required);
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  const describedBy = [
    child.props["aria-describedby"],
    descriptionId,
    errorId,
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  const control = React.cloneElement<FormControlProps>(child, {
    id: controlId,
    required: isRequired || undefined,
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
        {isRequired ? (
          <span aria-hidden="true" className="ml-[var(--space-2)] font-[number:var(--font-weight-body)] text-[var(--color-text-muted)]">
            필수
          </span>
        ) : null}
      </label>
      {description ? (
        <p
          id={descriptionId}
          className="m-0 font-[number:var(--font-weight-description)] text-[var(--color-text-muted)]"
        >
          {description}
        </p>
      ) : null}
      {controlAction ? <div className="flex items-center gap-[var(--space-2)] [&>input]:min-w-0 [&>input]:flex-1">{control}{controlAction}</div> : control}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className={errorVisuallyHidden ? "sr-only" : "m-0 text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] font-[number:var(--font-weight-body)] text-[var(--color-error)]"}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
