import { PageHeader } from "./PageHeader";

interface PagePlaceholderProps {
  title: string;
  description: string;
}

export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <section
      className="px-[var(--page-padding-inline)] py-[var(--space-8)]"
      aria-labelledby="page-title"
    >
      <PageHeader titleId="page-title" title={title} description={description} />
    </section>
  );
}
