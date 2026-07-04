function ProgressBar({ currentRound, totalRounds }) {
  const percentage = Math.round((currentRound / totalRounds) * 100);

  return (
    <section className="card">
      <div className="progress-header">
        <p>Season Progress</p>
        <strong>{currentRound}/{totalRounds}</strong>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percentage}%` }} />
      </div>
    </section>
  );
}

export default ProgressBar;
