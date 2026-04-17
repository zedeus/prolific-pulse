import { mount } from 'svelte';
import '../../assets/app.css';
import App from './App.svelte';

document.body.classList.add('no-scroll');
mount(App, { target: document.getElementById('app')! });
