export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-32 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
