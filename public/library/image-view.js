export function mountImageView(stage, image, controls) {
  const events = new AbortController();
  const options = {signal: events.signal};
  let zoom = 1;
  let x = 0;
  let y = 0;
  let drag = null;

  function draw() {
    const fit = Math.min(
      stage.clientWidth / (image.naturalWidth || 1),
      stage.clientHeight / (image.naturalHeight || 1),
    );
    const limitX = Math.max(0, (image.naturalWidth * fit * zoom - stage.clientWidth) / 2);
    const limitY = Math.max(0, (image.naturalHeight * fit * zoom - stage.clientHeight) / 2);
    x = Math.min(limitX, Math.max(-limitX, x));
    y = Math.min(limitY, Math.max(-limitY, y));
    image.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    stage.classList.toggle('is-zoomed', limitX > 0 || limitY > 0);
  }

  function setZoom(value, originX = 0, originY = 0) {
    const next = Math.min(6, Math.max(1, value));
    const ratio = next / zoom;
    x = originX + (x - originX) * ratio;
    y = originY + (y - originY) * ratio;
    zoom = next;
    draw();
  }

  controls.addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset.imageZoom;
    if (action === 'in') setZoom(zoom * 1.5);
    if (action === 'out') setZoom(zoom / 1.5);
    if (action === 'reset') setZoom(1);
  }, options);
  stage.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey || !event.deltaY) return;
    event.preventDefault();
    const box = stage.getBoundingClientRect();
    setZoom(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2),
      event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2);
  }, {...options, passive: false});

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || !stage.classList.contains('is-zoomed')) return;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY};
    stage.setPointerCapture(drag.id);
    stage.classList.add('is-dragging');
  }, options);
  stage.addEventListener('pointermove', event => {
    if (event.pointerId !== drag?.id) return;
    x += event.clientX - drag.x;
    y += event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    draw();
  }, options);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    stage.addEventListener(type, event => {
      if (event.pointerId !== drag?.id) return;
      drag = null;
      stage.classList.remove('is-dragging');
    }, options);
  }
  stage.addEventListener('keydown', event => {
    const offsets = {ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40]};
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    x += offset[0];
    y += offset[1];
    draw();
  }, options);
  image.addEventListener('load', draw, options);
  window.addEventListener('resize', draw, options);
  draw();

  return () => {
    events.abort();
    if (drag && stage.hasPointerCapture(drag.id)) stage.releasePointerCapture(drag.id);
    stage.classList.remove('is-zoomed', 'is-dragging');
  };
}
