import { Sortable } from "../modules/Sortable.mjs";
import { Utils } from "../utils/Utils.mjs";

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

    }

}