import { FONTS, PRESETS, matchingPreset } from "../lib/presets";
import type { CaptionMode, Position, Style } from "../lib/types";
import { useEditor } from "../store/editor";

const MODES: { value: CaptionMode; label: string }[] = [
  { value: "line", label: "Whole caption" },
  { value: "word_highlight", label: "Highlight spoken word" },
  { value: "one_word", label: "One word at a time" },
];

const POSITIONS: { value: Position; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
];

/** Presets plus manual controls for the caption style; changes preview live. */
export function StylePanel() {
  const style = useEditor((s) => s.project?.style);
  const setStyle = useEditor((s) => s.setStyle);
  if (!style) return null;
  const active = matchingPreset(style);
  const set = <K extends keyof Style>(key: K, value: Style[K]) => setStyle({ [key]: value });

  return (
    <div className="style-panel">
      <section>
        <h2>Presets</h2>
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={p.id === active?.id ? "preset active" : "preset"}
              aria-pressed={p.id === active?.id}
              onClick={() => setStyle(p.style)}
            >
              <strong>{p.name}</strong>
              <span>{p.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="fields">
        <h2>Text</h2>
        <label>
          Font
          <select value={style.font_family} onChange={(e) => set("font_family", e.target.value)}>
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <Slider label="Size" value={style.font_size} min={24} max={160} onChange={(v) => set("font_size", v)} />
        <div className="toggles">
          <Check label="Bold" checked={style.bold} onChange={(v) => set("bold", v)} />
          <Check label="UPPERCASE" checked={style.uppercase} onChange={(v) => set("uppercase", v)} />
          <Check
            label="Pop in"
            checked={style.animation === "pop"}
            onChange={(v) => set("animation", v ? "pop" : "none")}
          />
        </div>
        <div className="colors">
          <Color label="Text" value={style.color} onChange={(v) => set("color", v)} />
          <Color
            label="Highlight"
            value={style.highlight_color}
            onChange={(v) => set("highlight_color", v)}
          />
          <Color label="Outline" value={style.outline_color} onChange={(v) => set("outline_color", v)} />
        </div>
        <Slider
          label="Outline"
          value={style.outline_width}
          min={0}
          max={12}
          onChange={(v) => set("outline_width", v)}
        />
      </section>

      <section className="fields">
        <h2>Layout</h2>
        <label>
          Show
          <select value={style.mode} onChange={(e) => set("mode", e.target.value as CaptionMode)}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="radiogroup" aria-label="Position">
          {POSITIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={style.position === p.value}
              className={style.position === p.value ? "active" : ""}
              onClick={() => set("position", p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Slider
          label="Characters per line"
          value={style.max_chars_per_line}
          min={8}
          max={60}
          onChange={(v) => set("max_chars_per_line", v)}
        />
        <Slider label="Lines" value={style.max_lines} min={1} max={3} onChange={(v) => set("max_lines", v)} />
      </section>
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <span>
        {props.label} <output>{props.value}</output>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

function Color(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="color">
      <input type="color" value={props.value} onChange={(e) => props.onChange(e.target.value.toUpperCase())} />
      {props.label}
    </label>
  );
}
