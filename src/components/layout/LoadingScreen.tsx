export default function LoadingScreen({ label = "Loading Swosh Workspace…" }: { label?: string }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <span className="spinner spinner-lg" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}
