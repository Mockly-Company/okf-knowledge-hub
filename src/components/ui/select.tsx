import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectOptionProps {
  value: string;
  children: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}

export function SelectOption(_props: SelectOptionProps) {
  return null;
}

interface ParsedOption extends SelectOptionProps {
  key: React.Key;
}

function parseOptions(children: React.ReactNode): ParsedOption[] {
  return React.Children.toArray(children).flatMap((child, index) => {
    if (!React.isValidElement(child)) return [];

    if (child.type === "option") {
      const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
      if (props.value === undefined) return [];
      return [{
        key: child.key ?? index,
        value: String(props.value),
        children: props.children,
        disabled: props.disabled,
      }];
    }

    if (child.type === SelectOption) {
      const props = child.props as SelectOptionProps;
      return [{ key: child.key ?? index, ...props }];
    }

    return [];
  });
}

export interface SelectProps {
  id?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  placeholder?: string;
  className?: string;
  children: React.ReactNode;
  onValueChange?(value: string): void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
}

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({
    children,
    className,
    id,
    placeholder,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    value,
    defaultValue,
    disabled,
    required,
    name,
    onValueChange,
  }, ref) => {
    const options = parseOptions(children);
    const [open, setOpen] = React.useState(false);

    return (
      <SelectPrimitive.Root
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        required={required}
        name={name}
        onValueChange={onValueChange}
        onOpenChange={setOpen}
      >
        <SelectPrimitive.Trigger
          ref={ref}
          data-select-trigger=""
          id={id}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          className={cn(
            "flex h-[var(--control-height)] w-full min-w-0 cursor-pointer items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 font-[number:var(--font-weight-description)] text-[var(--color-text-strong)] transition-[border-color,background-color,color,border-radius] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] hover:border-[var(--color-border-hover)] focus-visible:border-[var(--color-primary)] aria-[invalid=true]:border-[var(--color-error)] aria-[invalid=true]:focus-visible:border-[var(--color-error)] disabled:cursor-not-allowed disabled:bg-[var(--color-control-disabled)] disabled:text-[var(--color-text-disabled)]",
            open && "!rounded-b-none",
            className,
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon asChild>
            <ChevronDown aria-hidden="true" className={cn("size-[var(--icon-size)] shrink-0 transition-transform duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] motion-reduce:transition-none", open && "rotate-180")} strokeWidth={1.75} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            side="bottom"
            sideOffset={-1}
            align="start"
            className="z-50 max-h-[min(320px,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-t-none rounded-b-[var(--radius-md)] border border-t-0 border-[var(--color-border)] bg-[var(--color-surface)] shadow-none"
          >
            <SelectPrimitive.Viewport className="grid gap-[var(--space-1)] p-[var(--space-1)]">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.key}
                  value={option.value}
                  disabled={option.disabled}
                  aria-label={
                    typeof option.children === "string" ? option.children : undefined
                  }
                  className={cn(
                    "relative flex min-h-[var(--control-height)] cursor-pointer select-none items-center rounded-[var(--radius-md)] py-[var(--space-2)] pr-[var(--space-10)] pl-[var(--space-3)] text-[var(--color-text-default)] outline-none transition-colors duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] focus-visible:outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-[var(--color-text-disabled)] data-[highlighted]:bg-[var(--color-primary-soft)] data-[state=checked]:bg-[var(--color-primary-soft)] data-[state=checked]:text-[var(--color-primary-text)]",
                    option.description && "min-h-[52px]",
                  )}
                >
                  <span className="grid min-w-0 gap-[var(--space-1)]">
                    <SelectPrimitive.ItemText>{option.children}</SelectPrimitive.ItemText>
                    {option.description ? (
                      <span className="text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  <SelectPrimitive.ItemIndicator className="absolute right-[var(--space-3)] grid place-items-center text-[var(--color-primary-text)]">
                    <Check aria-hidden="true" className="size-[var(--icon-size)]" strokeWidth={1.75} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    );
  },
);
Select.displayName = "Select";
