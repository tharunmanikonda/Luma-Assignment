import { presentAttempt } from "../presenter";
import type { GenerationAttemptRecord } from "../domain";

export function GenerationHistory({
  attempts
}: {
  attempts: GenerationAttemptRecord[];
}) {
  if (!attempts.length)
    return <p className="muted">No images have been created yet.</p>;
  return (
    <section aria-labelledby="generation-history-heading">
      <h2 id="generation-history-heading">Image history</h2>
      <ol className="generation-history">
        {[...attempts].reverse().map((attempt) => {
          const view = presentAttempt(attempt);
          return (
            <li key={attempt.id}>
              <strong>Candidate {attempt.attemptNumber}</strong>
              <span>{view.customerState.label}</span>
              <span>
                {view.estimate.currency} {view.estimate.amount} estimated
              </span>
              {view.customerState.nextAction ? (
                <p>{view.customerState.nextAction}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
