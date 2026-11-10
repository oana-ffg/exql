import { defaultPaneLayout, type PaneLayout } from "./paneLayout";
import type { ScriptSort } from "./scriptTree";

export interface AppSettings extends PaneLayout {
  scriptTimeoutSeconds: number;
  scriptSort: ScriptSort;
}

export const defaultSettings: AppSettings = {
  ...defaultPaneLayout,
  scriptTimeoutSeconds: 120,
  scriptSort: "name",
};
