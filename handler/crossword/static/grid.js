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
				char.onfocus = () => onFocused(x, y);
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
function ComputeGridView(grid, first, second, html, world, lastScale) {
	const view = {};

	/* fetch all necessary bounding boxes */
	const rWorld = world.getBoundingClientRect();
	const rFirst = grid.mesh[first[0]][first[1]].html.getBoundingClientRect();
	const rSecond = grid.mesh[second[0]][second[1]].html.getBoundingClientRect();

	/* compute the dimension of the content to be shown and the world as well as the maximum target dimensions */
	const cSize = [
		(Math.max(rFirst.right - rWorld.left, rSecond.right - rWorld.left) - Math.min(rFirst.left - rWorld.left, rSecond.left - rWorld.left)) / lastScale,
		(Math.max(rFirst.bottom - rWorld.top, rSecond.bottom - rWorld.top) - Math.min(rFirst.top - rWorld.top, rSecond.top - rWorld.top)) / lastScale
	];
	const wSize = [rWorld.width, rWorld.height];
	const tSize = [wSize[0] * (7 / 8), wSize[1] * (7 / 8)];

	/* compute the scale such that the target is reached along one axis, and the other axis is smaller */
	view.scale = Math.min(tSize[0] / cSize[0], tSize[1] / cSize[1]);

	/* compute the offset between the html container and the actual first cell */
	const rHtml = html.getBoundingClientRect();
	const rCell = grid.mesh[Math.min(first[0], second[0])][Math.min(first[1], second[1])].html.getBoundingClientRect();
	const offset = [(rCell.left - rHtml.left) / lastScale, (rCell.top - rHtml.top) / lastScale];

	/* compute the positions accordingly */
	view.pos = [0, 0];
	for (let i = 0; i < 2; ++i)
		view.pos[i] = ((wSize[i] - (cSize[i] * view.scale)) / 2) - (offset[i] * view.scale);
	return view;
}
