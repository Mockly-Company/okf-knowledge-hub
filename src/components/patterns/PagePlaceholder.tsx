interface PagePlaceholderProps {
  title: string;
  description: string;
}

export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <section className="p-8" aria-labelledby="page-title">
      <h1
        id="page-title"
        className="m-0 text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-bold text-[var(--color-text-strong)]"
      >
        {title}
      </h1>
      <p className="mt-2 text-[var(--color-text-muted)]">{description}</p>
    </section>
  );
}
