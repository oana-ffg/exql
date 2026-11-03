import { defaultPaneLayout, type PaneLayout } from "./paneLayout";

export interface AppSettings extends PaneLayout {
  scriptTimeoutSeconds: number;
}

export const defaultSettings: AppSettings = {
  ...defaultPaneLayout,
  scriptTimeoutSeconds: 120,
};
