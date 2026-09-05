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
| **Настройки** | Рост, размножение, молнии, огонь, влажность, ветер, размер клетки, буфер истории, seed |

## Правила (кратко)

1. **Рост** — деревья набирают возраст/биомассу; цвет от бледно-зелёного к тёмному. Скученность замедляет рост.
2. **Размножение** — зрелые деревья засевают соседние пустые клетки (окрестность Мура; диагонали слабее).
3. **Молнии** — редкий удар, чаще по старым деревьям → возгорание.
4. **Огонь** — горение по интенсивности (жёлтый→оранжевый→красный); распространение зависит от топлива, влажности и ветра; слабый огонь гаснет в пепел.
5. **Пепел** — постепенно становится пустой клеткой и снова может зарасти.

Сетка на typed arrays (`Uint8Array` / `Float32Array`), история — кольцевой буфер компактных снимков.

## Структура

```
index.html
styles.css
js/sim.js       — движок
js/render.js    — отрисовка Canvas
js/history.js   — кольцевой буфер + scrubber
js/ui.js        — панель управления
js/main.js      — запуск, rAF, ResizeObserver
```

## English (short)

Static forest cellular automaton. Clone the repo, serve the root with `npx serve .` or enable GitHub Pages from `/` or `/docs`. Scrub history like a video timeline; tweak growth, fire, humidity, wind, and RNG seed in Settings.

---

MIT-friendly sandbox — правьте параметры и делитесь сидами.
