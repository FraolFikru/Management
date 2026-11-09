/* =========================================================
   Accessible combobox (WAI-ARIA 1.2 list autocomplete).
   ↑/↓ move, Enter picks, Esc closes, mouse/touch select.
   ========================================================= */

export interface ComboOption<T> {
  value: T;
  html: string;
  /** "create" options are styled as an action row */
  variant?: "option" | "create";
}

export interface ComboResult<T> {
  heading: string;
  options: ComboOption<T>[];
}

export type ComboSource<T> = (query: string) => ComboResult<T>;

export function attachCombobox<T>(
  input: HTMLInputElement,
  list: HTMLUListElement,
  source: ComboSource<T>,
  onPick: (option: ComboOption<T>) => void,
): void {
  let options: ComboOption<T>[] = [];
  let active = -1;

  const close = (): void => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const paint = (): void => {
    list.querySelectorAll<HTMLElement>("[role=option]").forEach((el) => {
      const on = Number(el.dataset.index) === active;
      el.setAttribute("aria-selected", String(on));
      if (on) {
        input.setAttribute("aria-activedescendant", el.id);
        el.scrollIntoView({ block: "nearest" });
      }
    });
  };

  const open = (): void => {
    const res = source(input.value);
    options = res.options;
    if (!options.length) return close();
    active = input.value.trim() && options[0].variant !== "create" ? 0 : -1;
    list.innerHTML =
      (res.heading ? `<li role="presentation" class="opt-head">${res.heading}</li>` : "") +
      options
        .map((o, i) => `<li role="option" id="${list.id}-${i}" data-index="${i}" class="opt${o.variant === "create" ? " create" : ""}" aria-selected="false">${o.html}</li>`)
        .join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    paint();
  };

  const choose = (i: number): void => {
    const o = options[i];
    if (!o) return;
    close();
    onPick(o);
  };

  input.addEventListener("input", open);
  input.addEventListener("focus", open);
  // close shortly after blur (lets a click on an option land), unless focus came back meanwhile
  input.addEventListener("blur", () => window.setTimeout(() => { if (document.activeElement !== input) close(); }, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (list.hidden) open();
      else { active = Math.min(options.length - 1, active + 1); paint(); }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, active - 1);
      paint();
    } else if (e.key === "Enter" && !list.hidden && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape" && !list.hidden) {
      e.stopPropagation();
      close();
    }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[role=option]");
    if (li) choose(Number(li.dataset.index));
  });
}
