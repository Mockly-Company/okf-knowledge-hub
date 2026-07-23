import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  DEFAULT_DISPLAY_DENSITY,
  type DisplayDensity,
} from "./display-density";
import type { PreferencesRepository } from "./PreferencesRepository";

interface PreferencesContextValue {
  displayDensity: DisplayDensity;
  isLoading: boolean;
  setDisplayDensity(value: DisplayDensity): Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

interface PreferencesProviderProps extends PropsWithChildren {
  repository: PreferencesRepository;
}

export function PreferencesProvider({
  repository,
  children,
}: PreferencesProviderProps) {
  const [displayDensity, setDensityState] = useState<DisplayDensity>(
    DEFAULT_DISPLAY_DENSITY,
  );
  const [isLoading, setIsLoading] = useState(true);
  const isMountedRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;

    void repository.getDisplayDensity().then(
      (value) => {
        if (
          !active ||
          !isMountedRef.current ||
          generation !== generationRef.current
        ) {
          return;
        }

        setDensityState(value);
        setIsLoading(false);
      },
      () => {
        if (
          !active ||
          !isMountedRef.current ||
          generation !== generationRef.current
        ) {
          return;
        }

        setDensityState(DEFAULT_DISPLAY_DENSITY);
        setIsLoading(false);
      },
    );

    return () => {
      active = false;
      generationRef.current += 1;
    };
  }, [repository]);

  useLayoutEffect(() => {
    document.documentElement.dataset.density = displayDensity;
  }, [displayDensity]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      displayDensity,
      isLoading,
      async setDisplayDensity(nextValue) {
        const generation = ++generationRef.current;
        await repository.setDisplayDensity(nextValue);

        if (!isMountedRef.current || generation !== generationRef.current) {
          return;
        }

        setDensityState(nextValue);
        setIsLoading(false);
      },
    }),
    [displayDensity, isLoading, repository],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);

  if (!value) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }

  return value;
}
