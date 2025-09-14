/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2025 Bjoern Boss Henrichsen */
function _setupGridHtml(grid, onFocused, html) {
	/* create the separate cells */
	for (let y = 0; y < grid.height; ++y) {
		let row = document.createElement('div');
		row.classList.add('row');
		html.appendChild(row);

		/* add all of the cells */
		for (let x = 0; x < grid.width; ++x) {
			let cell = document.createElement('div');
			cell.classList.add('cell');
			row.appendChild(cell);

			/* add the char and index element */
			let char = document.createElement('div');
			char.classList.add('char');
			cell.appendChild(char);

			let index = document.createElement('div');
			index.classList.add('index');
			cell.appendChild(index);

			/* write the cell to the grid object */
			grid.mesh[x][y].html = cell;

			/* check if the cell should be editable */
			if (onFocused == null)
				char.contentEditable = false;
			else {
				char.contentEditable = true;
				char.onfocus = function () {
					if (!onFocused(x, y, true))
						char.blur();
				};
				char.onblur = () => onFocused(x, y, false);
				char.addEventListener('beforeinput', (e) => e.preventDefault());
			}
		}
	}
}

function GenerateGrid(width, height, html, onFocused, authorHue) {
	const grid = {
		width: width,
		height: height,
		mesh: []
	};

	/* create the grid object */
	grid.mesh = new Array(grid.width);
	for (let x = 0; x < grid.width; ++x) {
		grid.mesh[x] = new Array(grid.height);
		for (let y = 0; y < grid.height; ++y)
			grid.mesh[x][y] = { solid: false, html: null, char: '', certain: false, author: '' };
	}

	/* setup the html object */
	_setupGridHtml(grid, onFocused, html);

	/* render the new grid properly */
	RenderGrid(grid, authorHue);
	return grid;
}
function LoadGrid(data, html, onFocused, authorHue) {
	const grid = {
		width: data.width,
		height: data.height,
		mesh: []
	};

	/* create the grid object */
	grid.mesh = new Array(grid.width);
	for (let x = 0; x < grid.width; ++x) {
		grid.mesh[x] = new Array(grid.height);
		for (let y = 0; y < grid.height; ++y) {
			const cell = data.grid[x + y * grid.width];

			grid.mesh[x][y] = {
				solid: cell.solid,
				html: null,
				char: cell.char,
				certain: cell.certain,
				author: cell.author
			};
		}
	}

	/* setup the html object */
	_setupGridHtml(grid, onFocused, html);

	/* render the new grid properly */
	RenderGrid(grid, authorHue);
	return grid;
}
function ApplyGridUpdate(grid, data, authorHue) {
	/* iterate over the cells and update them */
	for (let y = 0; y < grid.height; ++y) {
		for (let x = 0; x < grid.width; ++x) {
			const next = data.grid[x + y * grid.width];
			const cell = grid.mesh[x][y];

			/* copy the state over */
			cell.solid = next.solid;
			cell.char = next.char;
			cell.author = next.author;
			cell.certain = next.certain;
		}
	}

	/* render the updated grid */
	RenderGrid(grid, authorHue);
}
function RenderGrid(grid, authorHue) {
	/* rule for digitization: if previous is solid or out of bounds, and next is not, add a digit (both for
	*	horizontal and vertical) and then assign digits from left to right, followed by top to bottom */
	let next = 0;

	/* iterate over the grid from left to right/top to bottom and render it properly and assign the digits */
	for (let y = 0; y < grid.height; ++y) {
		for (let x = 0; x < grid.width; ++x) {
			const cell = grid.mesh[x][y];

			/* check if the cell is solid, in which case nothing needs to be added */
			if (cell.solid) {
				cell.html.style.backgroundColor = '';
				cell.html.children[0].innerText = '';
				cell.html.children[1].innerText = '';
				cell.html.classList.add('solid');
				cell.html.classList.remove('uncertain');
				continue;
			}

			/* update the states solid flag */
			cell.html.classList.remove('solid');

			/* update the color */
			if (cell.author == '')
				cell.html.style.backgroundColor = '';
			else
				cell.html.style.backgroundColor = `hsl(${authorHue(cell.author)}, 90%, 90%)`;

			/* update the certainty  */
			if (cell.certain)
				cell.html.classList.remove('uncertain');
			else
				cell.html.classList.add('uncertain');

			/* update the letter */
			cell.html.children[0].innerText = cell.char.toUpperCase();

			/* check if an index should be added */
			let leftEmpty = (x > 0 && !grid.mesh[x - 1][y].solid);
			let topEmpty = (y > 0 && !grid.mesh[x][y - 1].solid);
			let rightEmpty = (x + 1 < grid.width && !grid.mesh[x + 1][y].solid);
			let bottomEmpty = (y + 1 < grid.height && !grid.mesh[x][y + 1].solid);

			/* check if an index should be assigned */
			if ((!leftEmpty && rightEmpty) || (!topEmpty && bottomEmpty))
				cell.html.children[1].innerText = `${++next}`;
			else
				cell.html.children[1].innerText = '';
		}
	}
}
function SolidSerializeAll(grid) {
	let out = { width: grid.width, height: grid.height, grid: [] };

	/* serialize the data out */
	for (let y = 0; y < grid.height; ++y) {
		for (let x = 0; x < grid.width; ++x)
			out.grid.push(grid.mesh[x][y].solid);
	}
	return out;
}
function FullSerializeGrid(grid) {
	let out = [];

	/* serialize the data out */
	for (let y = 0; y < grid.height; ++y) {
		for (let x = 0; x < grid.width; ++x) {
			out.push({
				char: grid.mesh[x][y].char,
				certain: grid.mesh[x][y].certain,
				author: grid.mesh[x][y].author
			});
		}
	}
	return out;
}

class GridView {
	constructor(container, content) {
		this._duration = 225;

		this._container = container;
		this._content = content;
		this._grid = null;
		this._goal = { x0: 0, x1: 0, y0: 0, y1: 0 };
		this._current = { x: 0, y: 0, scale: 1 };
		this._start = { x: 0, y: 0, scale: 1 };
		this._end = { x: 0, y: 0, scale: 1 };
		this._animationStart = 0;

		/* register the listener for changes */
		new ResizeObserver(() => this._update()).observe(this._container);
	}

	_animateNext() {
		/* check if the grid has been removed, in which case nothing needs to be done */
		if (this._grid == null)
			return;
		const lerp = (a, b, t) => (t >= 1 ? b : a + (b - a) * t);

		/* check if the goal has been reached */
		if (this._end.x == this._current.x && this._end.y == this._current.y && this._end.scale == this._current.scale)
			return;

		/* compute the new entry  */
		const progress = Math.max(0, (Date.now() - this._animationStart) / this._duration);
		this._current.x = lerp(this._start.x, this._end.x, progress);
		this._current.y = lerp(this._start.y, this._end.y, progress);
		this._current.scale = lerp(this._start.scale, this._end.scale, progress);

		/* write the value out */
		this._content.style.transform = `translate(${this._current.x}px, ${this._current.y}px) scale(${this._current.scale})`;

		/* queue the next animation */
		if (progress < 1)
			window.requestAnimationFrame(() => this._animateNext());
	}
	_animateTo(x, y, scale) {
		/* check if the goal is already set */
		if (x == this._end.x && y == this._end.y && scale == this._end.scale)
			return;

		/* setup the new animation target, and start the jurnery to it */
		this._start = { x: this._current.x, y: this._current.y, scale: this._current.scale };
		this._end = { x: x, y: y, scale: scale };
		this._animationStart = Date.now();
		this._animateNext();
	}
	_update() {
		/* check if no grid is available, in which case nothing needs to be done */
		if (this._grid == null)
			return;

		/* fetch all necessary bounding boxes */
		const rWorld = this._container.getBoundingClientRect();
		const rFirst = this._grid.mesh[this._goal.x0][this._goal.y0].html.getBoundingClientRect();
		const rSecond = this._grid.mesh[this._goal.x1][this._goal.y1].html.getBoundingClientRect();

		/* compute the dimension of the content to be shown and the world as well as the maximum target dimensions */
		const cSize = [
			((rSecond.right - rWorld.left) - (rFirst.left - rWorld.left)) / this._current.scale,
			((rSecond.bottom - rWorld.top) - (rFirst.top - rWorld.top)) / this._current.scale
		];
		const wSize = [rWorld.width, rWorld.height];
		const tSize = [wSize[0] * (7 / 8), wSize[1] * (7 / 8)];

		/* compute the scale such that the target is reached along one axis, and the other axis is smaller */
		let scale = Math.min(tSize[0] / cSize[0], tSize[1] / cSize[1]);

		/* compute the offset between the content and the actual first cell */
		const rContent = this._content.getBoundingClientRect();
		const rCell = this._grid.mesh[this._goal.x0][this._goal.y0].html.getBoundingClientRect();
		const offset = [(rCell.left - rContent.left) / this._current.scale, (rCell.top - rContent.top) / this._current.scale];

		/* compute the positions accordingly */
		let pos = [0, 0];
		for (let i = 0; i < 2; ++i)
			pos[i] = ((wSize[i] - (cSize[i] * scale)) / 2) - (offset[i] * scale);

		/* animate to the new data */
		this._animateTo(pos[0], pos[1], scale);
	}
	_target(first, second) {
		this._goal.x0 = Math.min(first[0], second[0]);
		this._goal.x1 = Math.max(first[0], second[0]);
		this._goal.y0 = Math.min(first[1], second[1]);
		this._goal.y1 = Math.max(first[1], second[1]);
	}
	_reset() {
		if (this._grid != null)
			this._target([0, 0], [this._grid.width - 1, this._grid.height - 1]);
	}

	target(first, second) {
		this._target(first, second);
		this._update();
	}
	reset() {
		this._reset();
		this._update();
	}
	update(grid) {
		/* check if the grid has been removed */
		if (grid == null) {
			this._grid = null;
			this._content.style.display = 'none';
			return;
		}

		/* check if the grid object is just being replaced */
		if (this._grid != null && this._grid.width == grid.width && this._grid.height == grid.height) {
			this._grid = grid;
			return;
		}

		/* show the grid and reset the view to contain the entire grid */
		this._content.style.display = 'block';
		this._grid = grid;
		this._reset();
		this._update();

		/* force the animation to reach the target immediately */
		this._animationStart -= 2 * this._duration;
		this._animateNext();
	}
	index(x, y) {
		if (this._grid == null)
			return [null, null];

		/* translate the position relative to the first cell */
		const rect = this._grid.mesh[0][0].html.getBoundingClientRect();
		x -= rect.left;
		y -= rect.top;

		/* estimate the index based on the size of the first cell */
		x = Math.floor(x / rect.width);
		y = Math.floor(y / rect.height);
		if (x < 0 || x >= this._grid.width || y < 0 || y >= this._grid.height)
			return [null, null];
		return [x, y];
	}
}

class GridFocus {
	constructor(view, onchange) {
		this._grid = null;
		this._name = '';
		this._view = view;

		this._cell = [0, 0];
		this._start = [0, 0];
		this._end = [0, 0];

		this._active = false;
		this._certain = false;
		this._horizontal = true;

		this._onchange = onchange;
	}

	_focused(x, y) {
		/* check if nothing needs to be done */
		if (this._grid != null && this._active && x >= this._start[0] && x <= this._end[0] && y >= this._start[1] && y <= this._end[1])
			return true;

		/* validate the request */
		this._cell = [x, y];
		this._start = [x, y];
		this._end = [x, y];
		if (this._grid == null || x < 0 || y < 0 || x >= this._grid.width || y >= this._grid.height || this._grid.mesh[x][y].solid) {
			this._active = false;
			this._view.reset();
			return false;
		}
		this._active = true;

		/* find the start and end cell */
		if (this._horizontal) {
			while (this._start[0] > 0 && !this._grid.mesh[this._start[0] - 1][y].solid)
				--this._start[0];
			while (this._end[0] + 1 < this._grid.width && !this._grid.mesh[this._end[0] + 1][y].solid)
				++this._end[0];
		}
		else {
			while (this._start[1] > 0 && !this._grid.mesh[x][this._start[1] - 1].solid)
				--this._start[1];
			while (this._end[1] + 1 < this._grid.height && !this._grid.mesh[x][this._end[1] + 1].solid)
				++this._end[1];
		}

		/* update the view */
		this._view.target(this._start, this._end);
		return true;
	}
	_lose() {
		this._active = false;
		this._view.reset();
		this._grid.mesh[this._cell[0]][this._cell[1]].html.children[0].blur();
	}
	_move(x, y, back) {
		/* find the next valid cell in the given direction (there must exist a
		*	non-solid cell, as move is called when a cell is already focused) */
		if (x < 0 || y < 0 || x >= this._grid.width || y >= this._grid.height || this._grid.mesh[x][y].solid) {
			while (true) {
				x += (back ? -1 : 1);

				/* wrap x around */
				if (x < 0) {
					--y;
					x = this._grid.width - 1;
				}
				else if (x >= this._grid.width) {
					++y;
					x = 0;
				}

				/* wrap y around */
				if (y < 0)
					y = this._grid.height - 1;
				else if (y >= this._grid.height)
					y = 0;

				/* check if the cell is solid */
				if (!this._grid.mesh[x][y].solid)
					break;
			}
		}

		/* focus the new cell */
		if (x != this._cell[0] || y != this._cell[1])
			this._grid.mesh[x][y].html.children[0].focus({ preventScroll: true });
	}
	_write(c) {
		const cell = this._grid.mesh[this._cell[0]][this._cell[1]];
		if (c != '' && this._name == '')
			return;

		/* update the cell content */
		cell.char = c;
		cell.author = (c == '' ? '' : this._name);
		cell.certain = (c != '' && this._certain);

		/* notify about the changed grid */
		this._onchange();
	}

	focused(x, y, focus) {
		if (focus)
			return this._focused(x, y);

		/* check if the focus has been lost */
		if (this._active && this._cell[0] == x && this._cell[1] == y) {
			this._active = false;
			this._view.reset();
		}
		return true;
	}
	input(c) {
		if (!this._active)
			return;

		/* write the key out and advance the character */
		this._write(c);
		this._move(this._cell[0] + (this._horizontal ? 1 : 0), this._cell[1] + (this._horizontal ? 0 : 1), false);
	}
	control(key) {
		if (!this._active)
			return;

		/* check if the focus should be lost */
		if (key == 'Escape') {
			this._lose();
			return true;
		}

		/* check if the focus should be passed on */
		if (key.startsWith('Arrow')) {
			this._move(
				this._cell[0] + (key == 'ArrowLeft' ? -1 : 0) + (key == 'ArrowRight' ? 1 : 0),
				this._cell[1] + (key == 'ArrowUp' ? -1 : 0) + (key == 'ArrowDown' ? 1 : 0),
				(key == 'ArrowLeft' || key == 'ArrowUp')
			);
			return true;
		}

		/* check if the current character should be deleted */
		const cell = this._grid.mesh[this._cell[0]][this._cell[1]];
		if (key != 'Backspace' && key != 'Delete')
			return false;

		/* either clear the cell or move back by one cell */
		if (cell.char != '')
			this._write('');
		else
			this._move(this._cell[0] - (this._horizontal ? 1 : 0), this._cell[1] - (this._horizontal ? 0 : 1), true);
		return true;
	}
	update(grid) {
		this._grid = grid;
		if (this._active)
			this._focused(this._cell[0], this._cell[1]);
	}
	config(certain, horizontal, name) {
		this._certain = certain;
		this._horizontal = horizontal;
		this._name = name;
		if (this._active)
			this._focused(this._cell[0], this._cell[1]);
	}
}
