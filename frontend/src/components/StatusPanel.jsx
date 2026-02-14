export default function StatusPanel({ status, error, onRetry }) {
  return (
    <div className="card">
      <h3>Solver Status</h3>
      <div className="kv">
        <span>Status</span>
        <div>
          <strong>{status}</strong>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {error && onRetry && (
        <button className="button secondary" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
