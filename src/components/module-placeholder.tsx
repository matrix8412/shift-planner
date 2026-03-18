type ModulePlaceholderProps = {
  title: string;
  summary: string;
  nextSteps: string[];
};

export function ModulePlaceholder({ title, summary, nextSteps }: ModulePlaceholderProps) {
  return (
    <section className="card stack">
      <div className="stack-tight">
        <p className="eyebrow">Module</p>
        <h1>{title}</h1>
        <p className="muted">{summary}</p>
      </div>

      <div className="stack-tight">
        <h2>Next implementation steps</h2>
        <ul className="plain-list">
          {nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

