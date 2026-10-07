import { App } from './app';
import { bindTips } from './tip';
import { manualOpen, toggleManual } from './manual';
import { animOn } from './dom';

const root = document.getElementById('app')!;
const app = new App(root);
app.render();
// Expose for automated UI tests and debugging.
(window as unknown as { sb: App }).sb = app;
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1') {
    e.preventDefault();
    toggleManual(() => app.render());
    return;
  }
  if (e.key === 'Escape' && manualOpen()) return toggleManual(() => app.render());
  if (e.key === 'Escape') app.toggleCover();
  if (e.key === 'F11' && window.sbNative) {
    e.preventDefault();
    window.sbNative.toggleFullscreen();
  }
});
bindTips();
document.body.classList.toggle('noanim', !animOn());
