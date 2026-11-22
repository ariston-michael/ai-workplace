import type { ReviewResult, ReviewEvidence } from "@/lib/specialists/reviews";
import "./specialist-report.css";
function Evidence({ items }: { items: ReviewEvidence[] }) {
  return <ol className="specialist-evidence">{items.map((e,i)=><li key={i}><code>{e.source}:{e.line}{e.side ? ` (${e.side} version)` : ""}</code><pre>{e.text}</pre></li>)}</ol>;
}
export default function SpecialistReport({ result }: { result: ReviewResult }) {
  const cloud = result.action === "deployment_review";
  return <section className="specialist-report" aria-label={cloud ? "Deployment review report" : "Pull request review report"}>
    <p className="specialist-mode">{result.demoInput && "DEMO INPUT · "}EXECUTED LOCALLY · READ-ONLY</p>
    <p>{result.summary}</p>
    <p className="specialist-meta">Method: bounded local rules ({result.method}). No external model or live system was consulted.</p>
    {result.findings.length ? result.findings.map((finding,i)=><article key={i} className="specialist-finding"><h4>{finding.title}</h4><p><strong>Confidence:</strong> {finding.confidence}{cloud && " · hypothesis, root cause unconfirmed"}</p><p><strong>Impact:</strong> {finding.impact}</p><h5>Evidence</h5><Evidence items={finding.evidence} /><h5>{cloud ? "Next diagnostic step" : "Suggested tests"}</h5><ul>{finding.suggestedTests.map(t=><li key={t}>{t}</li>)}</ul></article>) : <p>No supported pattern was identified. This is not a clean bill of health or an approval.</p>}
    {!!result.observations.length && <details><summary>Submitted evidence excerpts</summary><Evidence items={result.observations} /></details>}
    <h4>Uncertainty and review limits</h4><ul>{result.uncertainties.map(u=><li key={u}>{u}</li>)}</ul>
    <h4>{cloud ? "Diagnostic follow-up" : "Recommended follow-up"}</h4><ul>{result.nextSteps.map(s=><li key={s}>{s}</li>)}</ul>
    <p>No changes were made. Suggested steps and tests have not been executed.</p>
    <p className="specialist-meta">Submitted input SHA-256 <code>{result.inputSha256}</code></p>
  </section>;
}
