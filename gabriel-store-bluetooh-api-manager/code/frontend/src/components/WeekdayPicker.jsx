import { ToggleButton, ToggleButtonGroup } from "@mui/material";

export const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// `days` is an array of weekday indices (0=Mon..6=Sun); `onChange` receives
// the new array directly — MUI's non-exclusive ToggleButtonGroup already
// handles add/remove, no manual toggle logic needed.
export default function WeekdayPicker({ days, onChange }) {
  return (
    <ToggleButtonGroup size="small" value={days} onChange={(_, value) => onChange(value)}>
      {WEEKDAYS.map((label, i) => (
        <ToggleButton key={label} value={i} sx={{ px: 1.25 }}>{label}</ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
