export default function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-xl text-sm text-slate1">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
