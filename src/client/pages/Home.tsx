import { Wordmark } from '../components/ui';

export function Home() {
  return (
    <main className="narrow">
      <Wordmark size="lg" />
      <ul className="links">
        <li>
          <a href="/play">Jouer</a>
        </li>
        <li>
          <a href="/board">Écran</a>
        </li>
        <li>
          <a href="/console">Console</a>
        </li>
      </ul>
    </main>
  );
}
