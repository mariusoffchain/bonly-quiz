export function Home() {
  return (
    <div className="home">
      <h1>B-only Quiz</h1>
      <p className="muted">Quiz interactif, pools de minage fictives et vrais blocs Bitcoin.</p>
      <div className="card">
        <div className="card-title">Interfaces</div>
        <p>
          <a href="/play">/play</a> téléphone des participants (via le QR code de la session)
        </p>
        <p>
          <a href="/board">/board</a> écran de présentation
        </p>
        <p>
          <a href="/console">/console</a> console d’animation (jeton requis, affiché au démarrage du serveur)
        </p>
      </div>
    </div>
  );
}
