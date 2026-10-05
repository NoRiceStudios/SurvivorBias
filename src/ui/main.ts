import { App } from './app';

const root = document.getElementById('app')!;
const app = new App(root);
app.render();
// Expose for automated UI tests and debugging.
(window as unknown as { sb: App }).sb = app;
window.addEventListener('keydown', (e) => {
  if (e.key === 'F11' && window.sbNative) {
    e.preventDefault();
    window.sbNative.toggleFullscreen();
  }
});
