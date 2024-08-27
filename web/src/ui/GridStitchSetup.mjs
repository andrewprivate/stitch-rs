import { Sortable } from "../modules/Sortable.mjs";
import { Utils } from "../utils/Utils.mjs";
import { StitchVisualizer } from "./StitchVisualizer.mjs";
import { SliceDirection } from "./Viewer3D.mjs";

export class GridStitchSetup {
    constructor(controller) {
        this.controller = controller;
        this.ui = {};

        this.tileTableSortCriteria = 1;
        this.tileTableSortDirection = 1;

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
        input.type = 'range';
        input.min = inputMin;
        input.max = inputMax;
        input.step = inputStep;
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
            onEnd: (evt)=>{
                this.loadIndexedFromTable();
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


        // Add sliders for overlap x, y, and z
        this.ui.overlapX = this.createSliderWithLabel('Overlap X', 0, 100, 1);
        this.ui.step2.appendChild(this.ui.overlapX.inputCtn);

        this.ui.overlapY = this.createSliderWithLabel('Overlap Y', 0, 100, 1);
        this.ui.step2.appendChild(this.ui.overlapY.inputCtn);

        this.ui.overlapZ = this.createSliderWithLabel('Overlap Z', 0, 100, 1);
        this.ui.step2.appendChild(this.ui.overlapZ.inputCtn);

        this.ui.overlapX.input.value = 0;
        this.ui.overlapY.input.value = 0;
        this.ui.overlapZ.input.value = 0;
        


        // Add button to generate grid
        this.ui.generateGridButton = document.createElement('button');
        this.ui.generateGridButton.className = 'generate-grid-button';
        this.ui.generateGridButton.innerText = 'Generate Grid';
        this.ui.generateGridButton.addEventListener('click', () => {
            this.generateGrid();
        });

        this.ui.step2.appendChild(this.ui.generateGridButton);

        this.ui.container.appendChild(this.ui.step2);

        // Add grid preview
        this.ui.gridPreview = document.createElement('div');
        this.ui.gridPreview.className = 'grid-preview';
        this.ui.container.appendChild(this.ui.gridPreview);

        // Add 3d stitch preview viewer
        this.ui.stitchPreview = new StitchVisualizer({
            noZoom: true,
            noPan: true,
        });
        this.ui.gridPreview.appendChild(this.ui.stitchPreview.getElement());
    }

    loadIndexedFromTable(){
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

    }

    async generateGrid() {
        const gridWidth = Math.max(parseInt(this.ui.gridWidth.input.value), 1);
        const gridHeight = Math.max(parseInt(this.ui.gridHeight.input.value), 1);
        const gridDepth = Math.max(parseInt(this.ui.gridDepth.input.value), 1);

        // get size
        const size = gridWidth * gridHeight * gridDepth;
        if (size !== this.tileEntries.length) {
            alert('Grid size does not match number of tiles');
            return;
        }

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
            alert('Only two of grid width, height, and depth can be greater than 1');
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
        
        if (hasDepth || stitchDimensions.length === 1) {
            stitchDimensions.push('z');
            stitchKeys.push('depth');
        }

        if (stitchDimensions.length === 0) {
            alert('At least one of grid width, height, or depth must be greater than 1');
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

        for (let i = 0; i < dim1Size; i++) {
            for (let j = 0; j < dim2Size; j++) {
                let pos1 = i;
                let pos2 = snake ? (i % 2 === 0 ? j : dim2Size - 1 - j) : j;

                pos1 *= tileSize[dim1key];
                pos2 *= tileSize[dim2key];

                const offset = {
                    x: 0,
                    y: 0,
                    z: 0,
                    [dim1]: pos1,
                    [dim2]: pos2,
                    width: tileSize.width,
                    height: tileSize.height,
                    depth: tileSize.depth
                }

                offsets.push(offset);
            }
        }

        const images = await Promise.all(this.tileEntries.map(entry => entry.entry.imagePromise));
        this.ui.stitchPreview.setImages(images, offsets);

        // Set slice direction
        if (!stitchDimensions.includes('x')) {
            this.ui.stitchPreview.setSliceDirection(SliceDirection.X);
        } else if (!stitchDimensions.includes('y')) {
            this.ui.stitchPreview.setSliceDirection(SliceDirection.Y);
        } else if (!stitchDimensions.includes('z')) {
            this.ui.stitchPreview.setSliceDirection(SliceDirection.Z);
        }

    }

}