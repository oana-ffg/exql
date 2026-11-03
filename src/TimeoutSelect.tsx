const presets = [120, 300, 900, 1800, 3600, 0];
const useDefault = "default";
const custom = "custom";
const maxMinutes = 1440;

export function formatTimeout(seconds: number) {
  if (seconds === 0) return "No limit";
  if (seconds % 3600 === 0)
    return seconds === 3600 ? "1 hour" : `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} sec`;
}

export function parseTimeoutMinutes(text: string) {
  const seconds = Math.round(Number(text.trim()) * 60);
  return seconds >= 1 && seconds <= maxMinutes * 60 ? seconds : null;
}

function askForMinutes() {
  const answer = window.prompt("Timeout in minutes");
  if (answer === null) return null;
  const seconds = parseTimeoutMinutes(answer);
  if (seconds === null)
    window.alert(`Enter a number of minutes up to ${maxMinutes}.`);
  return seconds;
}

// Offering a default makes the value nullable: null means "use the default".
export function TimeoutSelect({
  value,
  onChange,
  defaultSeconds,
  label,
  disabled,
}: {
  value: number | null;
  onChange: (seconds: number | null) => void;
  defaultSeconds?: number;
  label?: string;
  disabled?: boolean;
}) {
  const options =
    value === null || presets.includes(value) ? presets : [...presets, value];
  return (
    <select
      aria-label={label}
      disabled={disabled}
      value={value ?? useDefault}
      onChange={(event) => {
        const selected = event.target.value;
        if (selected === useDefault) onChange(null);
        else if (selected === custom) {
          const seconds = askForMinutes();
          if (seconds !== null) onChange(seconds);
        } else onChange(Number(selected));
      }}
    >
      {defaultSeconds !== undefined && (
        <option value={useDefault}>
          Default ({formatTimeout(defaultSeconds)})
        </option>
      )}
      {options.map((seconds) => (
        <option value={seconds} key={seconds}>
          {formatTimeout(seconds)}
        </option>
      ))}
      <option value={custom}>Custom…</option>
    </select>
  );
}
