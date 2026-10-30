export function Home() {
  return (
    <div className="home">
      <div className="brand-lg">
        <span className="logo">₿</span> B-only Quiz
      </div>
      <p className="lead">21 questions, du hashrate à gagner, un bloc à miner.</p>
      <div className="home-links">
        <a className="btn primary big" href="/play">
          Jouer
        </a>
        <a className="btn big" href="/board">
          Écran de présentation
        </a>
        <a className="btn big" href="/console">
          Console d’animation
        </a>
      </div>
    </div>
  );
}
