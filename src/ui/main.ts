import { App } from './app';
import { installTextures } from './textures';
import { bindTips } from './tip';
import { manualOpen, toggleManual } from './manual';
import { animOn } from './dom';

installTextures();
// The lamp over the desk: its light changes with the phase of the week (body[data-phase]).
document.body.append(Object.assign(document.createElement('div'), { id: 'light', innerHTML: '<i class="lamp"></i><i class="dawn"></i><i class="vig"></i>' }));
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
