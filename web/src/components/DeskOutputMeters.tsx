import { useDjStore } from "../store/djStore";

/**
 * Post-fader output meters for the desk (values from {@link DjMixerEngine.getMeterLevels} via store).
 */
export function DeskOutputMeters() {
  const a = useDjStore((s) => s.peakOutputMeter.a);
  const b = useDjStore((s) => s.peakOutputMeter.b);
  const pctA = Math.round(Math.min(100, Math.max(0, a * 100)));
  const pctB = Math.round(Math.min(100, Math.max(0, b * 100)));
  const hA = Math.max(0.04, a);
  const hB = Math.max(0.04, b);

  return (
    <div className="desk-output-meters" role="group" aria-label="Post-fader output meters, display only">
      <span className="desk-output-meters__title" aria-hidden="true">
        Output
      </span>
      <div className="desk-output-meters__pair" aria-hidden="true">
        <div className="desk-output-meters__col desk-output-meters__col--a">
          <span className="desk-output-meters__ch">A</span>
          <div className="desk-output-meters__track">
            <div className="desk-output-meters__fill" style={{ transform: `scaleY(${hA})`, transformOrigin: "bottom" }} />
          </div>
        </div>
        <div className="desk-output-meters__col desk-output-meters__col--b">
          <span className="desk-output-meters__ch">B</span>
          <div className="desk-output-meters__track">
            <div className="desk-output-meters__fill" style={{ transform: `scaleY(${hB})`, transformOrigin: "bottom" }} />
          </div>
        </div>
      </div>
      <span className="sr-only">
        Deck A output about {pctA} percent. Deck B output about {pctB} percent.
      </span>
    </div>
  );
}
