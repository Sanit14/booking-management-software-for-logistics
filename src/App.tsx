import { strings } from './strings';

export default function App() {
  return (
    <main>
      <h1>{strings.appTitle}</h1>
      <p>
        {strings.version} {window.bm.version}
      </p>
    </main>
  );
}
