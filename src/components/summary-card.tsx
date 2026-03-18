type SummaryCardProps = {
  title: string;
  body: string;
};

export function SummaryCard({ title, body }: SummaryCardProps) {
  return (
    <article className="card stack-tight">
      <h2>{title}</h2>
      <p className="muted">{body}</p>
    </article>
  );
}

