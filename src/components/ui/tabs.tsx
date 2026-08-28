import * as React from "react";
import { cn } from "@/lib/utils";

export function TabsList({
  className,
  children,
  onKeyDown,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const tabChildren = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<TabsTriggerProps> =>
      React.isValidElement<TabsTriggerProps>(child) && child.type === TabsTrigger,
  );
  const selectedIndex = tabChildren.findIndex(
    (tab) => tab.props.selected && !tab.props.disabled,
  );
  const firstEnabledIndex = tabChildren.findIndex((tab) => !tab.props.disabled);
  const defaultFocusIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex;
  const [focusIndex, setFocusIndex] = React.useState(defaultFocusIndex);
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null);

  React.useEffect(() => {
    if (tabChildren[focusIndex]?.props.disabled) {
      setFocusIndex(defaultFocusIndex);
    }
  }, [defaultFocusIndex, focusIndex, tabChildren]);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const updateIndicator = () => {
      const selectedTab = list.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      if (!selectedTab) {
        setIndicator(null);
        return;
      }

      const listRect = list.getBoundingClientRect();
      const tabRect = selectedTab.getBoundingClientRect();
      setIndicator({
        left: tabRect.left - listRect.left,
        width: tabRect.width,
      });
    };

    updateIndicator();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateIndicator);
    observer?.observe(list);
    window.addEventListener("resize", updateIndicator);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [children, selectedIndex]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.getAttribute("role") !== "tab") {
      return;
    }

    const enabledTabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]:not(:disabled)"),
    );
    const currentIndex = enabledTabs.indexOf(target);
    if (currentIndex < 0 || enabledTabs.length === 0) return;

    const key = event.key;
    const nextIndex =
      key === "ArrowRight"
        ? (currentIndex + 1) % enabledTabs.length
        : key === "ArrowLeft"
          ? (currentIndex - 1 + enabledTabs.length) % enabledTabs.length
          : key === "Home"
            ? 0
            : key === "End"
              ? enabledTabs.length - 1
              : null;

    if (nextIndex === null) return;
    event.preventDefault();
    enabledTabs[nextIndex]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) moveFocus(event);
      }}
      className={cn(
        "relative flex w-full items-center gap-[var(--space-6)] border-b border-[var(--color-border)]",
        className,
      )}
      {...props}
    >
      {(() => {
        let tabIndex = 0;
        return React.Children.map(children, (child) => {
        if (
          !React.isValidElement<TabsTriggerProps>(child) ||
          child.type !== TabsTrigger
        ) {
          return child;
        }

        const index = tabIndex;
        tabIndex += 1;
        const childOnFocus = child.props.onFocus;
        return React.cloneElement(child, {
          tabIndex: index === focusIndex && !child.props.disabled ? 0 : -1,
          onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
            childOnFocus?.(event);
            if (!event.defaultPrevented) setFocusIndex(index);
          },
        });
        });
      })()}
      {indicator ? (
        <span
          aria-hidden="true"
          data-testid="tab-indicator"
          className="pointer-events-none absolute bottom-[-1px] left-0 h-0.5 rounded-t-[var(--radius-full)] bg-[var(--color-primary)] transition-[transform,width] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] motion-reduce:transition-none"
          style={{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }}
        />
      ) : null}
    </div>
  );
}

interface TabsTriggerProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "role"> {
  selected: boolean;
}

export const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  TabsTriggerProps
>(({ className, selected, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="tab"
    aria-selected={selected}
    className={cn(
      "h-[var(--control-height)] cursor-pointer border-0 bg-transparent px-0 text-[var(--color-text-default)] transition-[color] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] hover:text-[var(--color-text-strong)] focus-visible:rounded-[var(--radius-sm)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-primary)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-[var(--color-text-disabled)]",
      selected &&
        "font-[number:var(--font-weight-control)] text-[var(--color-primary-text)]",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";
