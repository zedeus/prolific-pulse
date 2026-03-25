import { mount } from 'svelte';
import '../../assets/app.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
