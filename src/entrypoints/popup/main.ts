import { mount } from 'svelte';
import '../../assets/app.css';
import App from './App.svelte';

if (import.meta.env.DEV) {
  import('../../lib/__dev__/dev-helpers').then((m) => m.attachDevHelpers());
}

document.body.classList.add('no-scroll');
mount(App, { target: document.getElementById('app')! });
