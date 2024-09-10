import { GrayImage3D } from "../Image.mjs";
import { Sortable } from "../modules/Sortable.mjs";
import { Utils } from "../utils/Utils.mjs";
import { StitchVisualizer } from "./StitchVisualizer.mjs";
import { SliceDirection, Viewer3DSliceWithControls } from "./Viewer3D.mjs";

export class GridStitchSetup {
    constructor(controller) {
        this.controller = controller;
        this.ui = {};

        this.tileTableSortCriteria = 1;
        this.tileTableSortDirection = 1;
        this.reverseX = false;
        this.reverseY = false;

        this.setupUI();
    }

    createInputWithLabel(labelText, inputType, inputMin, inputMax) {
        const inputCtn = document.createElement('div');
        inputCtn.classList.add('input-ctn');
        const input = document.createElement('input');
        input.type = inputType;
        input.min = inputMin;
        input.max = inputMax;
        const label = document.createElement('label');
        label.innerText = labelText;
        inputCtn.appendChild(label);
        inputCtn.appendChild(input);
        return {
            inputCtn,
            input,
            label
        }
    }

    createSliderWithLabel(labelText, inputMin, inputMax, inputStep) {
        const inputCtn = document.createElement('div');
        inputCtn.classList.add('input-ctn');
        const input = document.createElement('input');
        input.classList.add('slider');
        input.type = 'range';
        input.min = inputMin;
        input.max = inputMax;
        input.step = inputStep;
        const label = document.createElement('label');
        label.innerText = labelText;
        inputCtn.appendChild(label);
        inputCtn.appendChild(input);

        const valueInput = document.createElement('input');
        valueInput.classList.add('value-input');
        valueInput.type = 'number';
        valueInput.min = inputMin;
        valueInput.max = inputMax;
        valueInput.step = inputStep;
        inputCtn.appendChild(valueInput);

        let changeListeners = [];
        const registerChangeListener = (fn) => {
            changeListeners.push(fn);
        }

        input.addEventListener('input', () => {
            valueInput.value = input.value;
            changeListeners.forEach(fn => fn());
        });

        valueInput.addEventListener('input', () => {
            input.value = valueInput.value;
            changeListeners.forEach(fn => fn());
        });


        return {
            inputCtn,
            input,
            valueInput,
            label,
            registerChangeListener,
            setValue: (value) => {
                input.value = value;
                valueInput.value = value;
            }
        }
    }

    setupUI() {
        this.ui.container = document.createElement('div');
        this.ui.container.className = 'grid-stitch-setup';

        // Create Step 1
        this.ui.step1 = document.createElement('div');
        this.ui.step1.className = 'step1';
        this.ui.container.appendChild(this.ui.step1);

        this.ui.step1Title = document.createElement('h2');
        this.ui.step1Title.innerText = 'Step 1: Order tiles'
        this.ui.step1.appendChild(this.ui.step1Title);

        // Add tile table scroll
        this.ui.tileTableScroll = document.createElement('div');
        this.ui.tileTableScroll.className = 'tile-table-scroll';
        this.ui.step1.appendChild(this.ui.tileTableScroll);

        this.ui.tileTable = document.createElement('table');
        this.ui.tileTable.className = 'tile-table';
        this.ui.tileTableScroll.appendChild(this.ui.tileTable);

        // Table columns are: Filename, Width, Height, Depth, Last Modified, and Size

        // Create table header
        const tableHeader = document.createElement('thead');
        this.ui.tileTable.appendChild(tableHeader);

        const headerRow = document.createElement('tr');
        tableHeader.appendChild(headerRow);

        const headerColumns = ['Index', 'Filename', 'Width', 'Height', 'Depth', 'Last Modified', 'Size'];

        headerColumns.forEach((columnName, i) => {
            const th = document.createElement('th');
            th.innerText = columnName;
            headerRow.appendChild(th);

            th.addEventListener('click', () => {
                const index = headerColumns.indexOf(columnName);
                if (index === 0) return;

                if (index === this.tileTableSortCriteria) {
                    this.sortTileTable(index, -this.tileTableSortDirection);
                } else {
                    this.sortTileTable(index, 1);
                }

                // Remove sort indicators from other columns
                headerColumns.forEach((name, j) => {
                    headerRow.children[j].classList.remove('sorted-asc');
                    headerRow.children[j].classList.remove('sorted-desc');
                });

                // Add sort indicator to this column
                th.classList.remove('sorted-asc');
                th.classList.remove('sorted-desc');

                if (this.tileTableSortDirection === 1) {
                    th.classList.add('sorted-asc');
                } else {
                    th.classList.add('sorted-desc');
                }

                this.generateGrid();
            });

            if (i === this.tileTableSortCriteria) {
                if (this.tileTableSortDirection === 1) {
                    th.classList.add('sorted-asc');
                } else {
                    th.classList.add('sorted-desc');
                }
            }
        });

        // Create table body
        this.ui.tileTableBody = document.createElement('tbody');
        this.ui.tileTable.appendChild(this.ui.tileTableBody);

        Sortable.create(this.ui.tileTableBody, {
            onEnd: (evt) => {
                this.loadIndexedFromTable();
                this.generateGrid();
            },
        });

        this.loadTileTable();


        // Step 2
        this.ui.step2 = document.createElement('div');
        this.ui.step2.className = 'step2';

        this.ui.step2Title = document.createElement('h2');
        this.ui.step2Title.innerText = 'Step 2: Configure grid';
        this.ui.step2.appendChild(this.ui.step2Title);

        // Button container
        this.ui.buttonList = document.createElement('div');
        this.ui.buttonList.className = 'button-list';
        this.ui.step2.appendChild(this.ui.buttonList);


        this.ui.gridWidth = this.createInputWithLabel('Grid Width', 'number', 1, 100);
        this.ui.buttonList.appendChild(this.ui.gridWidth.inputCtn);

        this.ui.gridHeight = this.createInputWithLabel('Grid Height', 'number', 1, 100);
        this.ui.buttonList.appendChild(this.ui.gridHeight.inputCtn);

        this.ui.gridDepth = this.createInputWithLabel('Grid Depth', 'number', 1, 100);
        this.ui.buttonList.appendChild(this.ui.gridDepth.inputCtn);

        this.ui.gridWidth.input.value = 1;
        this.ui.gridHeight.input.value = 1;
        this.ui.gridDepth.input.value = 1;

        // Add select menu for grid type
        this.ui.gridType = document.createElement('select');
        this.ui.gridType.className = 'grid-type';
        this.ui.buttonList.appendChild(this.ui.gridType);

        const gridTypes = [
            'row-by-row',
            'column-by-column',
            'snake-by-row',
            'snake-by-column',
        ];

        gridTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.innerText = type;
            this.ui.gridType.appendChild(option);
        });

        this.ui.gridType.value = 'snake-by-row';

        // Add button to reverse x and y
        this.ui.reverseX = document.createElement('button');
        this.ui.reverseX.className = 'reverse-x';
        this.ui.reverseX.innerText = 'Reverse X';

        this.ui.reverseY = document.createElement('button');
        this.ui.reverseY.className = 'reverse-y';
        this.ui.reverseY.innerText = 'Reverse Y';

        this.ui.buttonList.appendChild(this.ui.reverseX);
        this.ui.buttonList.appendChild(this.ui.reverseY);

        this.ui.reverseX.addEventListener('click', () => {
            this.reverseX = !this.reverseX;
            this.generateGrid();
        });

        this.ui.reverseY.addEventListener('click', () => {
            this.reverseY = !this.reverseY;
            this.generateGrid();
        });



        // Add sliders for overlap x, y, and z
        this.ui.overlapX = this.createSliderWithLabel('Overlap X', 0, 100, 1);
        this.ui.step2.appendChild(this.ui.overlapX.inputCtn);

        this.ui.overlapY = this.createSliderWithLabel('Overlap Y', 0, 100, 1);
        this.ui.step2.appendChild(this.ui.overlapY.inputCtn);

        this.ui.overlapX.setValue(0)
        this.ui.overlapY.setValue(0);


        // // Add button to generate grid
        // this.ui.generateGridButton = document.createElement('button');
        // this.ui.generateGridButton.className = 'generate-grid-button';
        // this.ui.generateGridButton.innerText = 'Generate Grid';
        // this.ui.generateGridButton.addEventListener('click', () => {
        //     this.generateGrid();
        // });

        // this.ui.step2.appendChild(this.ui.generateGridButton);

        this.ui.otherButtonList = document.createElement('div');
        this.ui.otherButtonList.className = 'button-list';
        this.ui.step2.appendChild(this.ui.otherButtonList);

        // Add select for fuse mode
        const fuseModes = [
            'linear',
            'average',
            'max',
            'min',
            'overwrite',
            'overwrite-prioritize-center'
        ];

        this.ui.fuseMode = document.createElement('select');
        this.ui.fuseMode.className = 'fuse-mode';

        // Add label
        const fuseModeLabel = document.createElement('label');
        fuseModeLabel.innerText = 'Fuse Mode';
        this.ui.otherButtonList.appendChild(fuseModeLabel);
        this.ui.otherButtonList.appendChild(this.ui.fuseMode);

        fuseModes.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode;
            option.innerText = mode;
            this.ui.fuseMode.appendChild(option);
        });

        this.ui.fuseMode.value = 'linear';

        this.ui.fuseMode.addEventListener('change', () => {
            this.ui.stitchPreview.setFuseMode(this.ui.fuseMode.value);
        });

        this.ui.container.appendChild(this.ui.step2);

        // Add grid preview
        this.ui.gridPreview = document.createElement('div');
        this.ui.gridPreview.className = 'grid-preview';
        this.ui.container.appendChild(this.ui.gridPreview);

        // Add 3d stitch preview viewer
        this.ui.stitchPreview = new StitchVisualizer({
            // noZoom: true,
            // noPan: true,
        });
        this.ui.gridPreview.appendChild(this.ui.stitchPreview.getElement());

        this.generateGrid();


        // Add listeners
        this.ui.gridWidth.input.addEventListener('input', () => {
            this.generateGrid();
        });

        this.ui.gridHeight.input.addEventListener('input', () => {
            this.generateGrid();
        });

        this.ui.gridDepth.input.addEventListener('input', () => {
            this.generateGrid();
        });

        this.ui.gridType.addEventListener('change', () => {
            this.generateGrid();
        });

        this.ui.overlapX.registerChangeListener(() => {
            this.generateGrid();
        });

        this.ui.overlapY.registerChangeListener(() => {
            this.generateGrid();
        });

        // Step 3, setup priors
        this.ui.step3 = document.createElement('div');
        this.ui.step3.className = 'step3';
        this.ui.container.appendChild(this.ui.step3);

        this.ui.step3Title = document.createElement('h2');
        this.ui.step3Title.innerText = 'Step 3: Set Prior Distribution';
        this.ui.step3.appendChild(this.ui.step3Title);

        // Add slider for sigmaX and sigmaY
        this.ui.sigmaX = this.createSliderWithLabel('Sigma X', 1, 100, 1);
        this.ui.step3.appendChild(this.ui.sigmaX.inputCtn);

        this.ui.sigmaY = this.createSliderWithLabel('Sigma Y', 1, 100, 1);
        this.ui.step3.appendChild(this.ui.sigmaY.inputCtn);

        this.ui.sigmaZ = this.createSliderWithLabel('Sigma Z', 1, 100, 1);
        this.ui.step3.appendChild(this.ui.sigmaZ.inputCtn);

        this.ui.sigmaX.setValue(1);
        this.ui.sigmaY.setValue(1);
        this.ui.sigmaZ.setValue(1);

        this.ui.sigmaX.registerChangeListener(() => {
            this.updatePriors();
        });

        this.ui.sigmaY.registerChangeListener(() => {
            this.updatePriors();
        });

        this.ui.sigmaZ.registerChangeListener(() => {
            this.updatePriors();
        });

        // Add prior preview
        this.ui.priorPreviewCtn = document.createElement('div');
        this.ui.priorPreviewCtn.className = 'prior-preview-ctn';
        this.ui.step3.appendChild(this.ui.priorPreviewCtn);

        this.ui.priorPreview = new Viewer3DSliceWithControls({
            noZoom: true,
            noPan: true,
        });
        this.ui.priorPreviewCtn.appendChild(this.ui.priorPreview.getElement());
        this.updatePriors();


        // Step 4
        this.ui.step4 = document.createElement('div');
        this.ui.step4.className = 'step4';
        this.ui.container.appendChild(this.ui.step4);

        this.ui.step4Title = document.createElement('h2');
        this.ui.step4Title.innerText = 'Step 4: Save Configuration';
        this.ui.step4.appendChild(this.ui.step4Title);

        // Add save stitch_config.json button
        this.ui.saveButton = document.createElement('button');
        this.ui.saveButton.className = 'save-button';
        this.ui.saveButton.innerText = 'Save stitch_config.json';
        this.ui.step4.appendChild(this.ui.saveButton);

        // Add save TileConfiguration.txt button
        this.ui.saveTileConfigButton = document.createElement('button');
        this.ui.saveTileConfigButton.className = 'save-button';
        this.ui.saveTileConfigButton.innerText = 'Save TileConfiguration.txt';
        this.ui.step4.appendChild(this.ui.saveTileConfigButton);

        this.ui.saveButton.addEventListener('click', (e) => {
            const stitchConfig = this.generateStitchConfig();
            const blob = new Blob([stitchConfig], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            document.body.appendChild(a);
            a.style.display = 'none';
            a.href = url;
            a.download = 'stitch_config.json';
            a.click();
            URL.revokeObjectURL(url);
            a.remove();
        });


        this.ui.saveTileConfigButton.addEventListener('click', (e) => {
            const tileConfig = this.generateTileConfiguration();
            const blob = new Blob([tileConfig], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            document.body.appendChild(a);
            a.style.display = 'none';
            a.href = url;
            a.download = 'TileConfiguration.txt';
            a.click();
            URL.revokeObjectURL(url);
            a.remove();
        });
    }

    calc_guassian(x, y, z, x0, y0, z0, s0, s1, s2) {
        const dx = x - x0;
        const dy = y - y0;
        const dz = z - z0;
        let res = Math.exp(-0.5 * (dx * dx / s0 / s0 + dy * dy / s1 / s1 + dz * dz / s2 / s2));

        return res;
    }

    async updatePriors() {
        await Promise.all(this.tileEntries.map(entry => entry.entry.imagePromise));
        const totalWidth = this.tileEntries.reduce((acc, entry) => acc + entry.values[2], 0);
        const totalHeight = this.tileEntries.reduce((acc, entry) => acc + entry.values[3], 0);
        const totalDepth = this.tileEntries.reduce((acc, entry) => acc + entry.values[4], 0);

        let averageWidth = totalWidth / this.tileEntries.length;
        let averageHeight = totalHeight / this.tileEntries.length;
        let averageDepth = totalDepth / this.tileEntries.length;

        const overlapX = parseInt(this.ui.overlapX.input.value);
        const overlapY = parseInt(this.ui.overlapY.input.value);
        let overlap = Math.max(overlapX, overlapY);

        if (overlap === 0) {
            overlap = 100;
        }

        const sigmaX = parseFloat(this.ui.sigmaX.input.value);
        const sigmaY = parseFloat(this.ui.sigmaY.input.value);
        const sigmaZ = parseFloat(this.ui.sigmaZ.input.value);

        // const width = Math.ceil(averageWidth * overlap / 100);
        // const height = Math.ceil(averageHeight * overlap / 100);
        // const depth = Math.ceil(averageDepth * overlap / 100);
        const width = 150;
        const height = 150;
        const depth = 150;


        if (width * height * depth === 0) {
            return;
        }

        const imageData = new Uint8Array(width * height * depth);
        for (let z = 0; z < depth; z++) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const value = this.calc_guassian(x, y, z, width / 2, height / 2, depth / 2, sigmaX, sigmaY, sigmaZ);
                    imageData[z * width * height + y * width + x] = value * 255;
                }
            }
        }

        const image = new GrayImage3D({
            width,
            height,
            depth,
            data: imageData
        })

        this.priorImage = image;

        this.ui.priorPreview.setImage(image);
        this.ui.priorPreview.setSliceIndex(Math.floor(this.ui.priorPreview.getSliceCount() / 2));
    }

    generateStitchConfig() {
        const obj = {
            version: "1.0.0",
            overlap_ratio: 0
        }

        const tiles = this.gridTiles;
        const offsets = this.gridOffsets;

        let hasX = false;
        let hasY = false;
        let hasZ = false;

        tiles.forEach((tile, i) => {
            const sizeX = tile.values[2];
            const sizeY = tile.values[3];
            const sizeZ = tile.values[4];

            if (sizeX > 1) {
                hasX = true;
            }

            if (sizeY > 1) {
                hasY = true;
            }

            if (sizeZ > 1) {
                hasZ = true;
            }
        });

        let dimensions = Math.max((hasX ? 1 : 0) + (hasY ? 1 : 0) + (hasZ ? 1 : 0), 2);

        obj.mode = dimensions === 2 ? '2d' : '3d';

        obj["tile_paths"] = tiles.map((tile, i) => {
            return tile.entry.getName();
        });

        obj["tile_layout"] = offsets.map((offset, i) => {
            return [offset.x, offset.y, offset.z, offset.width, offset.height, offset.depth];
        });

        const priorX = parseFloat(this.ui.sigmaX.input.value);
        const priorY = parseFloat(this.ui.sigmaY.input.value);
        const priorZ = parseFloat(this.ui.sigmaZ.input.value);

        if (priorX > 1 || priorY > 1 || priorZ > 1) {
            obj["use_prior"] = true;
            obj["prior_sigma"] = [priorX, priorY, priorZ];
        }

        return JSON.stringify(obj, null, 4);
    }

    generateTileConfiguration() {
        const lines = [];
        lines.push("# Define the number of dimensions we are working on");

        const tiles = this.gridTiles;
        const offsets = this.gridOffsets;

        let hasX = false;
        let hasY = false;
        let hasZ = false;

        tiles.forEach((tile, i) => {
            const sizeX = tile.values[2];
            const sizeY = tile.values[3];
            const sizeZ = tile.values[4];

            if (sizeX > 1) {
                hasX = true;
            }

            if (sizeY > 1) {
                hasY = true;
            }

            if (sizeZ > 1) {
                hasZ = true;
            }
        });

        let dimensions = Math.max((hasX ? 1 : 0) + (hasY ? 1 : 0) + (hasZ ? 1 : 0), 2);
        lines.push(`dim = ${dimensions}`);

        lines.push("\n");

        lines.push("# Define the image coordinates");

        tiles.forEach((tile, i) => {
            const tileName = tile.entry.getName();
            const offset = offsets[i];

            const positions = [];

            if (hasX && hasY && !hasZ) {
                positions.push(`${offset.x.toFixed(1)}`, `${offset.y.toFixed(1)}`);
            } else {
                positions.push(`${offset.x.toFixed(1)}`, `${offset.y.toFixed(1)}`, `${offset.z.toFixed(1)}`);
            }

            lines.push(`${tileName}; ; (${positions.join(',')})`);
        });

        return lines.join('\n');
    }

    loadIndexedFromTable() {
        this.tileEntries.forEach((entry, i) => {
            if (entry.elements) {
                const row = entry.elements.row;
                const children = Array.from(this.ui.tileTableBody.children);
                const index = children.indexOf(row);

                entry.values[0] = index + 1;
                entry.elements.indexCell.innerText = entry.values[0];
            }
        });

        // Sort by index
        this.tileEntries.sort((a, b) => a.values[0] - b.values[0]);

        // Remove sort indicators from other columns
        const headerRow = this.ui.tileTable.children[0].children[0];
        const headerColumns = Array.from(headerRow.children);
        headerColumns.forEach((th, i) => {
            th.classList.remove('sorted-asc');
            th.classList.remove('sorted-desc');
        });

        this.tileTableSortCriteria = 0;
        this.tileTableSortDirection = 1;
    }
    loadTileTable() {
        const entries = this.controller.entries;
        // Filter entries by imagePromise
        const imageEntries = entries.filter(entry => entry.imagePromise);

        this.tileEntries = imageEntries.map((entry, i) => {
            const imagePromise = entry.imagePromise;
            const getMetaDataLazy = entry.getMetaDataLazy();
            const obj = {
                values: [-1, '', -1, -1, -1, -1, -1],
                entry,
                elements: null,
            }

            // Set index and filename
            obj.values[0] = i + 1;
            obj.values[1] = entry.getName();

            // Set width, height, and depth
            imagePromise.then(image => {
                obj.values[2] = image.width;
                obj.values[3] = image.height;
                obj.values[4] = image.depth;
            });

            // Set last modified and size
            getMetaDataLazy.then(metaData => {
                obj.values[5] = metaData.lastModified;
                obj.values[6] = metaData.size;
            });

            return obj;
        });

        this.sortTileTable(this.tileTableSortCriteria, this.tileTableSortDirection);
    }

    sortTileTable(criteria, direction) {
        this.tileTableSortCriteria = criteria;
        this.tileTableSortDirection = direction;

        if (criteria === 1) {
            // Use Utils.compareStringsWithNumbers
            this.tileEntries.sort((a, b) => {
                const aValue = a.values[criteria];
                const bValue = b.values[criteria];
                return Utils.compareStringsWithNumbers(aValue, bValue) * direction;
            });

        } else {
            this.tileEntries.sort((a, b) => {
                const aValue = a.values[criteria];
                const bValue = b.values[criteria];

                if (aValue < bValue) {
                    return -direction;
                } else if (aValue > bValue) {
                    return direction;
                } else {
                    return 0;
                }
            });
        }


        this.updateTileTable();
    }

    updateTileTable() {
        // Set new index values
        this.tileEntries.forEach((entry, i) => {
            entry.values[0] = i + 1;
        });

        // Clear existing rows
        this.ui.tileTableBody.replaceChildren();

        // Add new rows
        this.tileEntries.forEach((entry, index) => {
            if (!entry.elements) {
                const row = document.createElement('tr');

                const indexCell = document.createElement('td');
                row.appendChild(indexCell);

                const filenameCell = document.createElement('td');
                filenameCell.innerText = entry.entry.getName();
                row.appendChild(filenameCell);

                const widthCell = document.createElement('td');
                const heightCell = document.createElement('td');
                const depthCell = document.createElement('td');
                const lastModifiedCell = document.createElement('td');
                const sizeCell = document.createElement('td');

                const removeButton = document.createElement('button');
                removeButton.className = 'remove-button';
                removeButton.innerText = 'X';
                removeButton.addEventListener('click', () => {
                    this.tileEntries = this.tileEntries.filter(e => e !== entry);
                    this.updateTileTable();
                });

                row.appendChild(widthCell);
                row.appendChild(heightCell);
                row.appendChild(depthCell);
                row.appendChild(lastModifiedCell);
                row.appendChild(sizeCell);

                row.appendChild(removeButton);

                entry.entry.imagePromise.then(image => {
                    widthCell.innerText = image.width;
                    heightCell.innerText = image.height;
                    depthCell.innerText = image.depth;
                });

                entry.entry.getMetaDataLazy().then(metaData => {
                    lastModifiedCell.innerText = new Date(metaData.lastModified).toLocaleString();
                    sizeCell.innerText = metaData.size;
                });

                entry.elements = {
                    row,
                    indexCell,
                    filenameCell,
                    widthCell,
                    heightCell,
                    depthCell,
                    lastModifiedCell,
                    sizeCell
                }
            }

            entry.elements.indexCell.innerText = entry.values[0];
            this.ui.tileTableBody.appendChild(entry.elements.row);
        });
    }

    saveOrder() {
        const obj = {
            tileEntries: this.tileEntries.map(entry => {
                return {
                    index: entry.values[0],
                    name: entry.values[1],
                    width: entry.values[2],
                    height: entry.values[3],
                    depth: entry.values[4],
                    lastModified: entry.values[5],
                    size: entry.values[6]
                }
            })
        }

        const fs = this.controller.fs;

    }

    getElement() {
        return this.ui.container;
    }

    async render() {

        await this.ui.stitchPreview.render();
        await this.ui.priorPreview.render();

    }

    async generateGridInternal() {
        const gridWidth = Math.max(parseInt(this.ui.gridWidth.input.value), 1) || 1;
        const gridHeight = Math.max(parseInt(this.ui.gridHeight.input.value), 1) || 1;
        const gridDepth = Math.max(parseInt(this.ui.gridDepth.input.value), 1) || 1;

        // get size
        const size = gridWidth * gridHeight * gridDepth;

        const gridSize = {
            width: gridWidth,
            height: gridHeight,
            depth: gridDepth
        }
        const gridType = this.ui.gridType.value;

        let hasWidth = (gridWidth > 1) ? 1 : 0;
        let hasHeight = (gridHeight > 1) ? 1 : 0;
        let hasDepth = (gridDepth > 1) ? 1 : 0;

        if (hasWidth + hasDepth + hasHeight > 2) {
            return;
        }

        const dimensions = ['x', 'y', 'z'];
        const dimensionsKeys = ['width', 'height', 'depth'];

        const stitchDimensions = [];
        const stitchKeys = [];
        if (hasWidth) {
            stitchDimensions.push('x');
            stitchKeys.push('width');
        }

        if (hasHeight) {
            stitchDimensions.push('y');
            stitchKeys.push('height');
        }

        if (hasDepth) {
            stitchDimensions.push('z');
            stitchKeys.push('depth');
        }

        if (stitchDimensions.length === 0) {
            stitchDimensions.push('x');
            stitchKeys.push('width');
        }

        if (gridType === 'row-by-row' || gridType === 'snake-by-row') {
            // Reverse dimensions
            stitchDimensions.reverse();
            stitchKeys.reverse();
        } else if (gridType === 'column-by-column' || gridType === 'snake-by-column') {

        }

        let snake = false;
        if (gridType === 'snake-by-row' || gridType === 'snake-by-column') {
            snake = true;
        }

        // Find average width, height, and depth
        const totalWidth = this.tileEntries.reduce((acc, entry) => acc + entry.values[2], 0);
        const totalHeight = this.tileEntries.reduce((acc, entry) => acc + entry.values[3], 0);
        const totalDepth = this.tileEntries.reduce((acc, entry) => acc + entry.values[4], 0);

        let averageWidth = totalWidth / this.tileEntries.length;
        let averageHeight = totalHeight / this.tileEntries.length;
        let averageDepth = totalDepth / this.tileEntries.length;

        const tileSize = {
            width: averageWidth,
            height: averageHeight,
            depth: averageDepth
        }

        const offsets = [];

        const dim1 = stitchDimensions[0];
        const dim2 = stitchDimensions[1];
        const dim1key = stitchKeys[0];
        const dim2key = stitchKeys[1];
        const dim1Size = gridSize[dim1key];
        const dim2Size = gridSize[dim2key];

        const overlapX = parseInt(this.ui.overlapX.input.value);
        const overlapY = parseInt(this.ui.overlapY.input.value);
        const reverseX = this.reverseX;
        const reverseY = this.reverseY;

        let dim1Overlap, dim2Overlap;
        let dim1Reverse, dim2Reverse;
        if (dim2Size) {
            if (stitchDimensions[0] === 'x' || stitchDimensions[1] === 'y') {
                dim1Overlap = overlapX;
                dim2Overlap = overlapY;
                dim1Reverse = reverseX;
                dim2Reverse = reverseY;
            } else if (stitchDimensions[0] === 'y' || stitchDimensions[1] === 'x') {
                dim1Overlap = overlapY;
                dim2Overlap = overlapX;
                dim1Reverse = reverseY;
                dim2Reverse = reverseX;
            }
        } else {
            if (stitchDimensions[0] === 'x') {
                dim1Overlap = overlapX;
                dim1Reverse = reverseX;
            } else {
                dim1Overlap = overlapY;
                dim1Reverse = reverseY;
            }
        }

        for (let i = 0; i < dim1Size; i++) {
            if (dim2Size) {
                for (let j = 0; j < dim2Size; j++) {
                    let pos1 = i;
                    let pos2 = snake ? (i % 2 === 0 ? j : dim2Size - 1 - j) : j;

                    if (dim1Reverse) {
                        pos1 = dim1Size - 1 - pos1;
                    }

                    if (dim2Reverse) {
                        pos2 = dim2Size - 1 - pos2;
                    }

                    pos1 *= tileSize[dim1key] * (100 - dim1Overlap) / 100;
                    pos2 *= tileSize[dim2key] * (100 - dim2Overlap) / 100;

                    const offset = {
                        x: 0,
                        y: 0,
                        z: 0,
                        [dim1]: Math.floor(pos1),
                        [dim2]: Math.floor(pos2),
                        width: tileSize.width,
                        height: tileSize.height,
                        depth: tileSize.depth
                    }

                    offsets.push(offset);
                }
            } else {
                let pos1 = i;

                if (dim1Reverse) {
                    pos1 = dim1Size - 1 - pos1;
                }

                pos1 *= tileSize[dim1key] * (100 - dim1Overlap) / 100;

                const offset = {
                    x: 0,
                    y: 0,
                    z: 0,
                    [dim1]: Math.floor(pos1),
                    width: tileSize.width,
                    height: tileSize.height,
                    depth: tileSize.depth
                }

                offsets.push(offset);
            }
        }

        this.gridTiles = this.tileEntries.slice(0, size);
        this.gridOffsets = offsets.slice(0, size);
        const images = await Promise.all(this.gridTiles.map(entry => entry.entry.imagePromise));
        this.ui.stitchPreview.setImages(images, this.gridOffsets, this.gridTiles.map((tile, i) => {
            return tile.values[0] + ' - ' + tile.values[1];
        }));

        // Set slice direction
        if (stitchDimensions.length === 2) {
            if (!stitchDimensions.includes('x')) {
                this.ui.stitchPreview.setSliceDirection(SliceDirection.X);
            } else if (!stitchDimensions.includes('y')) {
                this.ui.stitchPreview.setSliceDirection(SliceDirection.Y);
            } else if (!stitchDimensions.includes('z')) {
                this.ui.stitchPreview.setSliceDirection(SliceDirection.Z);
            }
        } else {
            // Get smallest dim
            const bounds = this.ui.stitchPreview.getStitchedBounds();
            let smallestDim;

            const smallestDimSize = Math.min(hasWidth ? Infinity : bounds.width, hasHeight ? Infinity : bounds.height, hasDepth ? Infinity : bounds.depth);
            if (smallestDimSize === bounds.width) {
                smallestDim = SliceDirection.X;
            } else if (smallestDimSize === bounds.height) {
                smallestDim = SliceDirection.Y;
            } else if (smallestDimSize === bounds.depth) {
                smallestDim = SliceDirection.Z;
            }


            if (smallestDim) this.ui.stitchPreview.setSliceDirection(smallestDim);

        }
    }

    async generateGrid() {
        if (this.makingGrid) {
            this.needToRemakeGrid = true;
            return;
        }
        this.makingGrid = true;
        try {
            await this.generateGridInternal();
        } catch (e) {
            console.error(e);
        }
        this.makingGrid = false;

        if (this.needToRemakeGrid) {
            this.needToRemakeGrid = false;
            this.generateGrid();
        }
    }

}