// Setting Switcher slots. The two slots are the switch: tapping a slot's body makes it live (radio; one live at a time,
// arrow keys move between them); its ▾ end opens that slot's picker at any time: the target's list sheet (main.js).

/**
 * @param {HTMLElement} group  .slots radiogroup
 * @param {(slot: HTMLElement, target: string) => void} [onPick]  a slot's ▾ was tapped
 */
export function mountSwitcher(group, onPick) {
  const slots = [...group.querySelectorAll('.slot')];
  const bodies = slots.map((s) => s.querySelector('.sbody'));

  function live(i) {
    slots.forEach((s, k) => {
      const on = k === i;
      s.classList.toggle('on', on);
      bodies[k].setAttribute('aria-checked', String(on));
      bodies[k].tabIndex = on ? 0 : -1;
    });
  }

  const target = document.getElementById('swtarget');
  slots.forEach((s) => s.querySelector('.spick')?.addEventListener('click', () => onPick?.(s, target.value)));

  bodies.forEach((b, i) => {
    b.addEventListener('click', () => live(i));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const j = (i + 1) % bodies.length;
      live(j);
      bodies[j].focus();
    });
  });
  live(Math.max(0, slots.findIndex((s) => s.classList.contains('on'))));
}
