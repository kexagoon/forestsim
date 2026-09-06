# ForestSim

Клеточный симулятор леса на Canvas: рост деревьев, размножение, молнии, пожары и пепел. Чистый HTML/CSS/JS без сборки — удобно для GitHub Pages.

**ForestSim** — a tiny grid forest-fire sandbox (vanilla JS). Open `index.html` via any static server.

Репозиторий: [github.com/kexagoon/forestsim](https://github.com/kexagoon/forestsim)

## Как открыть локально

Нужен простой HTTP-сервер (модули не ES-modules, но `file://` иногда режет canvas/пути):

```bash
cd forestsim   # или корень репозитория
npx --yes serve .
# либо: python3 -m http.server 8080
```

Откройте указанный URL (обычно `http://localhost:3000` или `:8080`).

В VS Code / Cursor: расширение **Live Server** → Open with Live Server.

## GitHub Pages

1. Settings → Pages → Source: **Deploy from a branch**
2. Branch: `main` (или `master`), folder: **`/ (root)`** или **`/docs`**, если файлы лежат в `docs/`
3. Сохраните и подождите 1–2 минуты

Если сайт в `docs/`, скопируйте туда `index.html`, `styles.css` и папку `js/`.

## Управление

| Элемент | Действие |
|--------|----------|
| **Play / Пауза** | Запуск и остановка симуляции |
| **Шаг** | Один тик |
| **Сброс** | Новый лес с текущим seed и плотностью |
| **×1…×10** | Множитель скорости |
| **История** | Ползунок как у видео: просмотр прошлых кадров; «К живому краю» — снова live |
| **Инструменты** | Посадить / очистить / поджечь / потушить + размер кисти |
| **Настройки** | Рост, размножение, молнии/зажигание, огонь, влажность, ветер (авто/ручной), размер клетки, буфер истории, seed |
| **Ветер (HUD)** | В шапке: направление (° от севера) и сила из `sim.wind` |

## Модель / Model

Упрощённый образовательный клеточный автомат (не замена NFDRS / полного Rothermel).

### RU

1. **Рост** — деревья набирают возраст/биомассу; скученность замедляет рост.
2. **Размножение** — зрелые деревья засевают соседние пустые клетки (окрестность Мура).
3. **Молнии** — удар и зажигание разделены. Каждый CG-удар учитывается в статистике; возгорание только при «длинном продолжающемся токе» (LCC, ~25% концептуально) и сухих тонких горючих. Вероятность падает с влажностью (прокси влажности мёртвого топлива) и растёт с возрастом дерева (подстилка / высота).
4. **Огонь (эллиптический рост)** — скорость распространения по направлению зависит от угла к ветру: **головной** огонь (по ветру) заметно быстрее флангов и тыла (идеи Rothermel ROS, PROPAGATOR/CA с анизотропией ветра, эллиптический рост FBP). Влажность даёт damping до порога тушения (*moisture of extinction*). Редкая «переброска» (spotting) на 2 клетки по ветру при сильном огне.
5. **Ветер** — не случайный каждый тик: режим **авто** с инерцией (экспоненциальное сглаживание к редким целям направления/скорости) и затухающими порывами. Огонь всегда использует живой вектор `windDx/Dy` + `windStrength`.
6. **Пепел** — постепенно становится пустой клеткой и снова может зарасти.

Ссылки (концепции): Rothermel (1972) rate of spread; PROPAGATOR / CA fire models с ветровой анизотропией; Fuquay / Latham — lightning ignition & long continuing current; Canadian FBP — elliptical head/flank/back.

### EN

Simplified educational CA — not a full NFDRS replacement.

- **Elliptical wind-driven spread**: head fire ≫ flank ≫ backfire; ROS-style wind coefficient × fuel moisture damping (moisture of extinction). Inspired by Rothermel, PROPAGATOR-style CA probabilities, FBP ellipse.
- **Lightning**: strike ≠ ignition. Most CG strikes do not ignite; LCC proxy (~¼) + dry fine fuels needed (Fuquay/Latham concepts). Humidity/fuel moisture suppress ignition; older trees slightly easier.
- **Persistent wind**: auto mode slowly lerps toward rare random targets (high persistence / inertia); optional decaying gusts. Fire uses the live wind vector every tick.

## Правила (кратко)

1. **Рост** — цвет от бледно-зелёного к тёмному по возрасту.
2. **Размножение** — диагонали слабее.
3. **Молнии** — `lightnings` ≥ `firesStarted` (удар ≠ пожар).
4. **Огонь** — интенсивность жёлтый→оранжевый→красный; гаснет в пепел при низкой интенсивности / кончившемся топливе.
5. **Пепел** → EMPTY → снова лес.

Сетка на typed arrays (`Uint8Array` / `Float32Array`), история — кольцевой буфер компактных снимков.

## Структура

```
index.html
styles.css
js/sim.js       — движок (ветер, молнии, эллиптический огонь)
js/render.js    — отрисовка Canvas
js/history.js   — кольцевой буфер + scrubber
js/ui.js        — панель управления
js/main.js      — запуск, rAF, ResizeObserver
```

## English (short)

Static forest cellular automaton. Clone the repo, serve the root with `npx serve .` or enable GitHub Pages from `/` or `/docs`. Scrub history like a video timeline; tweak growth, fire, humidity, persistent wind, lightning ignition, and RNG seed in Settings.

---

MIT-friendly sandbox — правьте параметры и делитесь сидами.
