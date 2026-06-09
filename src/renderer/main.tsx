import { render } from 'preact';
import { App } from './App';
import './styles.css';
import '@shared/electron-api';

render(<App />, document.getElementById('app')!);
