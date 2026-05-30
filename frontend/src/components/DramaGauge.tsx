import { dramaColor, dramaLabel } from "../lib/format";

/** A 0-100 Drama Score gauge with the baseline (resolution threshold) marked. */
export function DramaGauge({
  score,
  baseline,
}: {
  score: number;
  baseline: number;
}) {
  const { text, color } = dramaLabel(score);
  return (
    <div className="drama">
      <div className="drama-head">
        <span className="drama-num" style={{ color: dramaColor(score) }}>
          {score}
          <span className="drama-max">/100</span>
        </span>
        <span className="drama-tag" style={{ color }}>
          {text}
        </span>
      </div>
      <div className="drama-track">
        <div
          className="drama-fill"
          style={{ width: `${score}%`, background: dramaColor(score) }}
        />
        <div
          className="drama-baseline"
          style={{ left: `${baseline}%` }}
          title={`Resolution baseline: ${baseline}`}
        />
      </div>
      <div className="drama-legend">
        <span>Drama Score (live)</span>
        <span>baseline {baseline}</span>
      </div>
    </div>
  );
}
