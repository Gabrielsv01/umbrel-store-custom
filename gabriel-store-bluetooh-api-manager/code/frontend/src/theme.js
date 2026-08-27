import { createTheme } from "@mui/material/styles";

// Mirrors the palette that used to live in styles.css (:root vars) so the
// MUI migration doesn't change the app's visual identity.
export const theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0f1420", paper: "#172033" },
    primary: { main: "#3b82f6" },
    success: { main: "#34d399" },
    warning: { main: "#fbbf24" },
    error: { main: "#f87171" },
    divider: "#2b3a57",
    text: { primary: "#e6ecf5", secondary: "#8ba0c0" },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  },
  components: {
    // MUI's dark-mode elevation adds a subtle white-alpha overlay that gets
    // stronger the higher the elevation — so a Card (low elevation) nested
    // inside a Drawer/Dialog Paper (higher elevation) renders a visibly
    // different, lighter shade than its container, reading as a "box inside
    // a box" seam. Flattening it on Paper itself (which Card/Drawer/Dialog
    // all extend) keeps every surface the same flat background regardless
    // of nesting depth.
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
      },
    },
    // Stack is `display:flex` under the hood, and a flex item's default
    // min-width is "auto" (its content size) — which means a Stack nested
    // inside another Stack/flex container silently refuses to shrink below
    // its widest content, pushing the whole page wider than the viewport on
    // narrow screens instead of letting its own flexWrap/wrapping do its
    // job. This bit us repeatedly (header chips, forms, search bar) as
    // separate one-off fixes; overriding it here fixes the whole class at
    // once instead of chasing each new occurrence individually.
    MuiStack: {
      styleOverrides: {
        root: { minWidth: 0 },
      },
    },
  },
});
