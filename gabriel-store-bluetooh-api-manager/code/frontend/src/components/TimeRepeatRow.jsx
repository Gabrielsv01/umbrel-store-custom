import { Stack, TextField, FormControl, InputLabel, Select, MenuItem } from "@mui/material";

// Shared by Voice.jsx (TTS scheduling) and Schedule.jsx (audio scheduling) —
// they used to duplicate this time/repeat/date row markup verbatim.
export default function TimeRepeatRow({ time, onTimeChange, repeat, onRepeatChange, date, onDateChange }) {
  return (
    // flex-basis (not just flexWrap) forces each field to wrap onto its own
    // line as soon as it would otherwise get cramped, instead of all three
    // squeezing onto one row on a narrow phone.
    <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
      <TextField
        label="Horário" type="time" size="small" value={time}
        onChange={(e) => onTimeChange(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ flex: "1 1 140px" }}
      />
      <FormControl size="small" sx={{ flex: "1 1 160px" }}>
        <InputLabel>Repetir</InputLabel>
        <Select label="Repetir" value={repeat} onChange={(e) => onRepeatChange(e.target.value)}>
          <MenuItem value="once">Uma vez</MenuItem>
          <MenuItem value="daily">Todo dia</MenuItem>
          <MenuItem value="weekly">Semanalmente</MenuItem>
        </Select>
      </FormControl>
      {repeat === "once" && (
        <TextField
          label="Data" type="date" size="small" value={date}
          onChange={(e) => onDateChange(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ flex: "1 1 160px" }}
        />
      )}
    </Stack>
  );
}
