import { useLayoutEffect, type PropsWithChildren } from "react";
import type { Preview } from "@storybook/react-vite";
import { DEFAULT_DISPLAY_DENSITY } from "@/features/preferences/display-density";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "@/styles/globals.css";

function DensityRoot({
  density,
  children,
}: PropsWithChildren<{ density: "default" | "compact" }>) {
  useLayoutEffect(() => {
    document.documentElement.dataset.density = density;

    return () => {
      delete document.documentElement.dataset.density;
    };
  }, [density]);

  return <>{children}</>;
}

const preview: Preview = {
  globalTypes: {
    displayDensity: {
      name: "Display density",
      description: "Approved OkHub display density",
      toolbar: {
        icon: "mirror",
        items: [
          { title: "Default", value: "default" },
          { title: "Compact", value: "compact" },
        ],
      },
    },
  },
  initialGlobals: {
    displayDensity: DEFAULT_DISPLAY_DENSITY,
  },
  decorators: [
    (Story, context) => {
      const displayDensity =
        context.globals.displayDensity === "compact"
          ? "compact"
          : DEFAULT_DISPLAY_DENSITY;

      return (
        <DensityRoot density={displayDensity}>
          <Story />
        </DensityRoot>
      );
    },
  ],
  parameters: {
    options: {
      storySort: {
        order: [
          "기초 스타일",
          "UI 컴포넌트",
          "문서 컴포넌트",
          "화면",
          ["시작·연결", "홈", "문서", ["목록", "상세", "새 문서", "작성·편집", "리뷰"], "프로젝트", "설정"],
          "사용 흐름",
        ],
      },
    },
    a11y: {
      test: "error",
    },
  },
};

export default preview;
