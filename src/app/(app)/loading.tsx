export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-4 pt-6 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-32 animate-pulse rounded bg-line" />
      <div className="h-8 w-64 animate-pulse rounded-lg bg-line" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-[14px] border border-line bg-white" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-[14px] border border-line bg-white" />
    </div>
  );
}
